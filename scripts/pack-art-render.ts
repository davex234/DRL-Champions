/**
 * PRODUCCIÓN DE ARTWORK DE SOBRES — `npm run pack-art:render` (Fase 20.1).
 *
 * Rasteriza el MASTER PACK DESIGN (`scripts/pack-art/master.ts`) a ficheros WEBP con alfa real
 * en `public/packs/`, uno por producto. Sin herramienta de generación de imágenes en el
 * entorno, este es el camino que prevé el §14 del encargo: master vectorial + render real.
 *
 *   npm run pack-art:render              renderiza todo
 *   npm run pack-art:render -- --only=champions,icon
 *   npm run pack-art:render -- --svg     además deja el SVG fuente al lado (revisión)
 *
 * ══════════════════════════ EL CATÁLOGO DE ASSETS ══════════════════════════
 *
 * Cada entrada es DATOS sobre el master: material, emblema, microdetalles. Ninguna es un
 * diseño aparte, y por eso los 19 se reconocen como familia.
 *
 * Los `file` siguen la convención que YA existe en `src/data/packArtwork.ts`
 * (`pack-<packId>`), no la del ejemplo del encargo, porque el §13 manda respetar el
 * manifiesto existente y no crear dos convenciones. Donde el encargo decía `pack-icono`, el
 * producto real se llama `icon`, así que el fichero es `pack-icon`.
 *
 * ══════════════════════════ QUÉ ES DATO Y QUÉ ES ARTE ══════════════════════════
 *
 * · **Acentos: DATOS.** Salen de `data/packs.ts` (el `accent` que cada sobre ya declaraba),
 *   de `design/tokens` (RARITY para los metales) y de `data/teams.ts` (marca del equipo).
 * · **Monogramas: DATOS.** La etiqueta real del equipo (`teamMonogram`).
 * · **Tonos del metal base y elección de emblema: ARTE.** Son dirección de arte, no datos de
 *   juego: no afectan a probabilidades, precios ni pools.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { packFrontSvg, ART_W, ART_H, type PackArtSpec, type Material } from "./pack-art/master";
import { RARITY, ACCENT } from "../src/design/tokens";
import { getPack } from "../src/data/packs";
import { teamMonogram } from "../src/components/packs/packIdentity";
import { IMPORT_MAP } from "./pack-art-import";

const OUT = join(process.cwd(), "public", "packs");
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith("--only=")) ?? "").replace("--only=", "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const alsoSvg = args.includes("--svg");
const force = args.includes("--force");

/**
 * LOS QUE YA NO SE RENDERIZAN — llegó su ARTE OFICIAL.
 *
 * Estos ficheros ya no salen de este master vectorial: los entregó arte y los importó
 * `scripts/pack-art-import.ts`. Volver a rasterizarlos aquí los destruiría en silencio, así que
 * se saltan. `--force` los recupera al arte procedimental a propósito, nunca por descuido.
 */
const OFICIALES = new Set(IMPORT_MAP.map((m) => `pack-${m.packId}`));

/**
 * METAL MACIZO: el propio material es el color (bronce, plata, oro).
 *
 * La zona de sellado y el escudo del emblema se derivan del METAL, no de un negro fijo: con un
 * negro fijo, sobre plata pulida la banda superior cortaba el objeto en dos y el emblema se
 * leía como una pegatina negra pegada encima (se vio en el primer render).
 */
const metal = (
  light: string, mid: string, dark: string, accent: string,
  ink: string, inkSoft: string, flap: [string, string], emblemBase: [string, string],
): Material => ({ base: [light, mid, dark], accent, sheen: 0.9, foil: 0.8, ink, inkSoft, flap, emblemBase });

/** Cuerpo oscuro con acento: la mayoría de la familia. Tinta blanca y escudo grafito. */
const dark = (accent: string, opts: { sheen?: number; foil?: number; top?: string; mid?: string; bot?: string } = {}): Material =>
  ({
    base: [opts.top ?? "#1b2030", opts.mid ?? "#0a0c14", opts.bot ?? "#141824"],
    accent,
    sheen: opts.sheen ?? 0.45,
    foil: opts.foil ?? 0.7,
    ink: "#ffffff",
    inkSoft: "#ffffff",
    // La solapa es el mismo cuerpo, un paso más oscuro: sigue siendo el mismo material.
    flap: [opts.top ?? "#1b2030", "#07080e"],
    emblemBase: ["#232838", "#05060c"],
  });

/** El acento REAL que el sobre declara en el catálogo. Si no es un producto, se pasa a mano. */
const packAccent = (id: string, fallback: string): string => getPack(id)?.accent ?? fallback;

const SPECS: PackArtSpec[] = [
  /* ─────────────── FASE B · PACKS DE RAREZA (7) ─────────────── */
  {
    // Metal industrial: el más mate de los tres, foil bajo, un solo anillo.
    file: "pack-bronce", name: "Bronce", line: "Rareza", code: "NX-BRZ-26",
    material: metal(
      "#e0a165", "#a2652a", "#3d2610", RARITY.bronze,
      "#ffffff", "#2e1a08", ["#6b431c", "#2a1a0b"], ["#5a3a18", "#1d1108"],
    ),
    emblem: "nexus", rings: 1, bars: 1,
  },
  {
    file: "pack-plata", name: "Plata", line: "Rareza", code: "NX-SLV-26",
    material: metal(
      "#f2f6fa", "#aab6c4", "#4a5360", RARITY.silver,
      "#0b0d18", "#1d2530", ["#8e9aa8", "#3f4752"], ["#6c7683", "#252b33"],
    ),
    emblem: "nexus", rings: 2, bars: 2,
  },
  {
    file: "pack-oro", name: "Oro", line: "Rareza", code: "NX-GLD-26",
    material: metal(
      "#ffe9a8", "#d9a520", "#4d3705", RARITY.gold,
      "#2a2000", "#3a2c00", ["#9c7409", "#3a2a04"], ["#7a5c06", "#241a02"],
    ),
    emblem: "nexus", rings: 3, bars: 3,
  },
  {
    // MASTER: competición. Oscuro y sobrio, el laurel como emblema.
    file: "pack-masters", name: "Masters", line: "Evento", code: "NX-MST-26",
    material: dark(packAccent("masters", "#ff8a3d"), { sheen: 0.6, top: "#241a12", mid: "#0b0a10", bot: "#1a1410" }),
    emblem: "laurel", rings: 2, bars: 2,
  },
  {
    // CHAMPIONS: la cúspide de competición. Máximo brillo y tres anillos.
    file: "pack-champions", name: "Champions", line: "Evento", code: "NX-CHM-26",
    material: dark(packAccent("champions", "#ffd35c"), { sheen: 0.95, foil: 1, top: "#2a2313", mid: "#0c0a08", bot: "#1d180c" }),
    emblem: "laurel", rings: 3, bars: 3,
  },
  {
    /*
     * EWC. No está en la lista de 35 del encargo, pero es un producto VIVO: el tercer sobre de
     * evento del catálogo, y se enseña en la banda de eventos de la tienda. Sin su artwork
     * quedaría dibujado al lado de un Masters y un Champions con arte — la familia se juzga
     * completa o no se juzga. Lo cazó un test al comprobar el manifiesto contra el catálogo.
     */
    file: "pack-ewc", name: "EWC", line: "Evento", code: "NX-EWC-26",
    material: dark(packAccent("ewc", "#19e3ff"), { sheen: 0.7, foil: 0.85, top: "#13232b", mid: "#080d10", bot: "#101a1f" }),
    emblem: "laurel", rings: 2, bars: 2,
  },
  {
    // ICONO: histórico. Hueso sobre grafito, medalla, tres anillos.
    file: "pack-icon", name: "Icono", line: "Colección", code: "NX-ICN-26",
    material: dark(packAccent("icon", "#f5f0e6"), { sheen: 0.85, foil: 0.9, top: "#24242a", mid: "#0b0b0d", bot: "#191919" }),
    emblem: "medal", rings: 3, bars: 3,
  },
  {
    // MVPS: reconocimiento individual. Trofeo, carmesí de marca.
    file: "pack-mvps", name: "MVPs", line: "Reconocimiento", code: "NX-MVP-26",
    material: dark(ACCENT.primary, { sheen: 0.75, top: "#2a1020", mid: "#0b060c", bot: "#1d0a16" }),
    emblem: "trophy", rings: 2, bars: 2,
  },

  /* ─────────────── FASE C · REGIONALES (4) ─────────────── */
  /*
   * Los cuatro comparten ACENTO (el cian que los cuatro declaran en el catálogo) y familia de
   * emblema, porque son la MISMA división del circuito. Lo que les da identidad propia es la
   * CONSTRUCCIÓN del globo —meridiano, ejes cruzados, arcos, retícula— más el tono del metal.
   *
   * Hizo falta: en el primer render completo los cuatro eran indistinguibles, que es «la misma
   * bolsa cambiando de color» sin ni siquiera cambiar el color. Geometría abstracta del
   * circuito, nunca banderas ni iconografía nacional (§6).
   */
  {
    file: "pack-emea", name: "EMEA", line: "Regional", code: "NX-EMEA-26",
    material: dark(packAccent("emea", "#19e3ff"), { top: "#16212b", mid: "#080c10", bot: "#111a20" }),
    emblem: "meridian", emblemVariant: 0, rings: 1, bars: 1,
  },
  {
    file: "pack-americas", name: "Américas", line: "Regional", code: "NX-AMER-26",
    material: dark(packAccent("americas", "#19e3ff"), { top: "#1d2028", mid: "#090a0e", bot: "#15171d" }),
    emblem: "meridian", emblemVariant: 1, rings: 1, bars: 1,
  },
  {
    file: "pack-pacific", name: "Pacific", line: "Regional", code: "NX-PAC-26",
    material: dark(packAccent("pacific", "#19e3ff"), { top: "#13242a", mid: "#070d0f", bot: "#0f1c21" }),
    emblem: "meridian", emblemVariant: 2, rings: 1, bars: 1,
  },
  {
    file: "pack-china", name: "China", line: "Regional", code: "NX-CHN-26",
    material: dark(packAccent("china", "#19e3ff"), { top: "#231a20", mid: "#0a070a", bot: "#1a1318" }),
    emblem: "meridian", emblemVariant: 3, rings: 1, bars: 1,
  },

  /* ─────────────── PRODUCTOS DE LA CASA (4) ─────────────── */
  /*
   * No están en la lista de 35 del encargo, pero SÍ son productos vivos de la tienda. Sin su
   * artwork, la vitrina quedaría mitad con arte y mitad dibujada: el §21 pide comprobar la
   * familia, y una familia a medias no se puede juzgar.
   */
  {
    file: "pack-inicial", name: "Inicial", line: "Bienvenida", code: "NX-INI-26",
    material: dark(packAccent("inicial", "#19e3ff"), { sheen: 0.3, foil: 0.5 }), emblem: "ascent", rings: 1,
  },
  {
    file: "pack-estandar", name: "Estándar", line: "Nexus", code: "NX-STD-26",
    material: dark(packAccent("estandar", "#8b96a3"), { sheen: 0.35, foil: 0.55 }), emblem: "nexus", rings: 1,
  },
  {
    file: "pack-premium", name: "Premium", line: "Nexus", code: "NX-PRM-26",
    material: dark(packAccent("premium", "#ffce4f"), { sheen: 0.7, foil: 0.85 }), emblem: "nexus", rings: 2, bars: 2,
  },
  {
    file: "pack-prime", name: "Prime", line: "Nexus", code: "NX-PRI-26",
    material: dark(packAccent("prime", "#7b5cff"), { sheen: 0.7, top: "#1d1830", mid: "#08060f", bot: "#161028" }),
    emblem: "nexus", rings: 2, bars: 2,
  },

  /* ─────────────── TEAM PACKS EXISTENTES (4) ─────────────── */
  /*
   * IDENTIDAD TIPOGRÁFICA, NO LOGO. En el repositorio no hay ni un logo oficial de equipo
   * (`public/teams/` solo tiene un README), y el §7 prohíbe dibujar uno falso. Se usa el
   * MONOGRAMA con la etiqueta real del equipo dentro del escudo NEXUS — que es exactamente el
   * respaldo que el propio README de `public/teams/` declara aprobado para el proyecto.
   *
   * Quedan marcados como pendientes de logo oficial en el informe y en el README de assets.
   */
  {
    file: "pack-team-heretics", name: "Team Heretics", line: "Team Pack", code: "NX-TH-26",
    material: dark(packAccent("team-heretics", "#cfd3dc"), { sheen: 0.7, top: "#20222a", mid: "#08090c", bot: "#16181e" }),
    emblem: "crest", monogram: teamMonogram("Team Heretics"), rings: 2,
  },
  {
    file: "pack-team-fnatic", name: "Fnatic", line: "Team Pack", code: "NX-FNC-26",
    material: dark(packAccent("team-fnatic", "#ff5900"), { sheen: 0.7, top: "#2a1a10", mid: "#0b0704", bot: "#1d1108" }),
    emblem: "crest", monogram: teamMonogram("Fnatic"), rings: 2,
  },
  {
    file: "pack-team-navi", name: "NAVI", line: "Team Pack", code: "NX-NAVI-26",
    material: dark(packAccent("team-navi", "#ffe500"), { sheen: 0.7, top: "#26240f", mid: "#0a0904", bot: "#1a180a" }),
    emblem: "crest", monogram: teamMonogram("NAVI"), rings: 2,
  },
  {
    file: "pack-team-g2", name: "G2", line: "Team Pack", code: "NX-G2-26",
    material: dark(packAccent("team-g2", "#8e97a8"), { sheen: 0.6, top: "#1e2129", mid: "#08090c", bot: "#15171d" }),
    emblem: "crest", monogram: teamMonogram("G2"), rings: 2,
  },
];

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const pedidos = only.length
    ? SPECS.filter((s) => only.some((o) => s.file === o || s.file === `pack-${o}`))
    : SPECS;
  const protegidos = force ? [] : pedidos.filter((s) => OFICIALES.has(s.file));
  const lista = force ? pedidos : pedidos.filter((s) => !OFICIALES.has(s.file));

  if (protegidos.length > 0) {
    console.log(`· ${protegidos.length} con arte oficial, intactos: ${protegidos.map((s) => s.file).join(", ")}`);
    console.log("  (para volver al arte procedimental: --force)\n");
  }

  if (lista.length === 0) {
    /* Que todo lo pedido esté protegido no es un error: es el caso normal desde el arte oficial. */
    if (pedidos.length > 0) { console.log("Nada que renderizar: todo lo pedido tiene arte oficial."); return; }
    console.error(`No hay assets que encajen con --only=${only.join(",")}`);
    process.exit(1);
  }

  console.log(`\n═══ ARTWORK DE SOBRES — ${lista.length} assets a ${ART_W}×${ART_H} (WEBP con alfa) ═══\n`);

  for (const spec of lista) {
    const svg = packFrontSvg(spec);
    if (alsoSvg) writeFileSync(join(OUT, `${spec.file}.svg`), svg, "utf8");

    /*
     * `density` alto: librsvg rasteriza el SVG a la resolución que se le pide, y con el valor
     * por defecto (72 ppp) el texto y los trazados finos salen blandos. Se rasteriza grande y
     * se reduce al lienzo final, que es lo que da los bordes limpios.
     */
    const png = await sharp(Buffer.from(svg), { density: 220 })
      .resize(ART_W, ART_H, { fit: "fill" })
      .png()
      .toBuffer();

    // WEBP con alfa SIN pérdida en el canal alfa: el recorte de la silueta tiene que ser neto.
    const webp = await sharp(png).webp({ quality: 92, alphaQuality: 100, effort: 5 }).toBuffer();
    writeFileSync(join(OUT, `${spec.file}.webp`), webp);

    // Comprobación del asset: ¿tiene alfa REAL y la esquina del chaflán está recortada?
    const meta = await sharp(webp).metadata();
    const { data, info } = await sharp(webp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number): number => data[(y * info.width + x) * info.channels + 3];
    const esquinaLibre = alphaAt(info.width - 4, 3) === 0; // esquina superior derecha: chaflán
    const centroOpaco = alphaAt(info.width >> 1, info.height >> 1) > 250;

    const kb = (webp.length / 1024).toFixed(0);
    const ok = meta.hasAlpha && esquinaLibre && centroOpaco;
    console.log(
      `  ${ok ? "✓" : "✗"} ${spec.file.padEnd(22)} ${String(kb).padStart(4)} KB` +
      `  ${meta.width}×${meta.height}  alfa=${meta.hasAlpha ? "sí" : "NO"}` +
      `  chaflán=${esquinaLibre ? "recortado" : "OPACO"}  centro=${centroOpaco ? "opaco" : "TRANSPARENTE"}`,
    );
    if (!ok) process.exitCode = 1;
  }

  console.log(`\n  ${lista.length} assets en public/packs/`);
  console.log("  Siguiente paso: declararlos en PACK_ART_AVAILABLE (src/data/packArtwork.ts)\n");
}

main().catch((e: unknown) => {
  console.error("\n✕ render de artwork abortado:", e instanceof Error ? e.message : e);
  process.exit(1);
});
