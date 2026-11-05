/**
 * VERIFICACIÓN DE LOS ASSETS DE MAPA — `npm run maps:verify`
 *
 * La regla que impuso el producto es una sola y es absoluta: **los PNG no se tocan**. Ni
 * recortar, ni escalar, ni recolorear, ni convertir, ni recomprimir, ni regenerar.
 *
 * Un comentario que diga «no los toques» no impide nada. Esto sí: compara el **hash
 * SHA-256** de cada asset servido contra el fichero maestro de `mapas/finalizados`. Si un
 * día alguien optimiza la carpeta `public/` con una herramienta automática —que es
 * exactamente como se pierden los originales—, esta comprobación se pone roja.
 *
 * También comprueba lo demás que puede desincronizarse sin avisar: que el catálogo y los
 * ficheros hablan de los mismos doce mapas, que las dimensiones declaradas son las que
 * tiene el PNG de verdad, y que ningún componente construye rutas de mapa a mano.
 *
 * No escribe nada. No abre ningún PNG para escritura.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TACTICAL_MAPS, availableMaps, getTacticalMap } from "@/domain/tactics";
import { mapImageSrc } from "@/lib/assets";

const ROOT = process.cwd();
const MAESTROS = join(ROOT, "mapas", "finalizados");
const SERVIDOS = join(ROOT, "public", "maps");

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

/** Lee anchura y altura de la cabecera IHDR. No decodifica la imagen. */
function pngSize(p: string): { w: number; h: number; ok: boolean; iend: boolean } {
  const b = readFileSync(p);
  const firma = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const ihdr = b.subarray(12, 16).toString("ascii") === "IHDR";
  const iend = b.subarray(b.length - 8, b.length - 4).toString("ascii") === "IEND";
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), ok: firma && ihdr, iend };
}

function main(): void {
  console.log("# Verificación de los ASSETS DE MAPA del Entrenador\n");

  // ══════════════════════════════════════════════════════════════════
  console.log("## 1 · LOS DOCE FICHEROS");
  // ══════════════════════════════════════════════════════════════════
  check("existe la carpeta de maestros", existsSync(MAESTROS), MAESTROS);
  check("existe la carpeta servida", existsSync(SERVIDOS), SERVIDOS);

  const servidos = existsSync(SERVIDOS) ? readdirSync(SERVIDOS).filter((f) => f.endsWith(".png")).sort() : [];
  check("hay exactamente doce PNG servidos", servidos.length === 12, `${servidos.length}`);

  const enCatalogo = TACTICAL_MAPS.map((m) => m.asset).sort();
  check("los ficheros servidos son los del catálogo, ni uno más ni uno menos",
    JSON.stringify(servidos) === JSON.stringify(enCatalogo),
    servidos.filter((f) => !enCatalogo.includes(f)).join(", ") || "coinciden");

  // ══════════════════════════════════════════════════════════════════
  console.log("\n## 2 · LOS PNG NO SE HAN TOCADO");
  // ══════════════════════════════════════════════════════════════════
  {
    let iguales = 0;
    const distintos: string[] = [];
    for (const m of TACTICAL_MAPS) {
      const maestro = join(MAESTROS, m.asset);
      const servido = join(SERVIDOS, m.asset);
      if (!existsSync(maestro) || !existsSync(servido)) { distintos.push(`${m.asset}(falta)`); continue; }
      if (sha(maestro) === sha(servido)) iguales++;
      else distintos.push(m.asset);
    }
    check("cada asset servido es IDÉNTICO al maestro (SHA-256)",
      iguales === TACTICAL_MAPS.length && distintos.length === 0,
      distintos.length ? distintos.join(", ") : `${iguales}/12 idénticos`);

    let mismoPeso = 0;
    for (const m of TACTICAL_MAPS) {
      const a = join(MAESTROS, m.asset), b = join(SERVIDOS, m.asset);
      if (existsSync(a) && existsSync(b) && statSync(a).size === statSync(b).size) mismoPeso++;
    }
    check("ninguno se ha recomprimido (mismo tamaño en bytes)", mismoPeso === 12, `${mismoPeso}/12`);
  }

  // ══════════════════════════════════════════════════════════════════
  console.log("\n## 3 · EL CATÁLOGO DICE LA VERDAD SOBRE EL FICHERO");
  // ══════════════════════════════════════════════════════════════════
  {
    const malas: string[] = [];
    const rotos: string[] = [];
    for (const m of TACTICAL_MAPS) {
      const p = join(SERVIDOS, m.asset);
      if (!existsSync(p)) { rotos.push(`${m.id}(falta)`); continue; }
      const { w, h, ok, iend } = pngSize(p);
      if (!ok || !iend) rotos.push(m.id);
      if (w !== m.width || h !== m.height) malas.push(`${m.id}: catálogo ${m.width}×${m.height} vs fichero ${w}×${h}`);
    }
    check("los doce son PNG válidos y completos", rotos.length === 0, rotos.join(", "));
    check("las dimensiones del catálogo son las REALES del PNG", malas.length === 0, malas.join(" · "));

    const fuera = TACTICAL_MAPS.filter((m) =>
      m.frame.x < 0 || m.frame.y < 0 ||
      m.frame.x + m.frame.width > m.width || m.frame.y + m.frame.height > m.height);
    check("el encuadre de cada mapa cabe dentro de su lienzo", fuera.length === 0,
      fuera.map((m) => m.id).join(", "));
  }

  // ══════════════════════════════════════════════════════════════════
  console.log("\n## 4 · UNA SOLA FUENTE DE VERDAD");
  // ══════════════════════════════════════════════════════════════════
  {
    check("`mapImageSrc` compone la ruta pública", mapImageSrc("ascent.png") === "/maps/ascent.png",
      mapImageSrc("ascent.png"));

    for (const id of ["abyss", "ascent", "bind", "breeze", "corrode", "fracture",
      "haven", "icebox", "lotus", "pearl", "split", "sunset"]) {
      const m = getTacticalMap(id);
      if (!m) { check(`«${id}» está en el catálogo`, false); continue; }
    }
    check("los doce ids esperados resuelven en el catálogo",
      ["abyss", "ascent", "bind", "breeze", "corrode", "fracture",
        "haven", "icebox", "lotus", "pearl", "split", "sunset"]
        .every((id) => !!getTacticalMap(id)));

    check("los cuatro trazados retirados ya no resuelven",
      ["terminal", "cantera", "orbita", "meridiano"].every((id) => !getTacticalMap(id)));

    check("los doce están disponibles en el selector", availableMaps().length === 12,
      `${availableMaps().length}`);

    /*
     * Rutas escritas a mano. El objetivo del catálogo era que nadie volviera a escribir
     * `/maps/ascent.png` en un componente; si alguien lo hace, el día que los assets se
     * muevan habrá que buscarlo a mano.
     */
    const sospechosos: string[] = [];
    const barrer = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { barrer(p); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        const txt = readFileSync(p, "utf8");
        // `assets.ts` es el único sitio donde la ruta puede aparecer.
        if (p.endsWith(join("lib", "assets.ts"))) continue;
        if (/["'`]\/maps\//.test(txt)) sospechosos.push(p.replace(ROOT + "\\", "").replace(/\\/g, "/"));
      }
    };
    barrer(join(ROOT, "src"));
    check("ningún componente escribe una ruta de mapa a mano", sospechosos.length === 0,
      sospechosos.join(", "));
  }

  console.log(
    fail === 0
      ? `\n✅ LOS ASSETS DE MAPA ESTÁN INTACTOS Y EL CATÁLOGO CUADRA — ${pass}/${pass + fail}`
      : `\n❌ ${fail} COMPROBACIÓN(ES) FALLARON — ${pass}/${pass + fail}`,
  );
  process.exit(fail === 0 ? 0 : 1);
}

main();
