/**
 * ARTES OFICIALES DE SOBRE — el contrato de `packId → artwork`.
 *
 * Los artes entregados por arte (`sobres/*.png`) se importan a `public/packs/pack-<packId>.webp`
 * con `scripts/pack-art-import.ts`. Aquí se fija lo que no puede romperse:
 *
 *   · UNA sola resolución: `packArtwork(packId)`. Ninguna pantalla construye su propia ruta.
 *   · Lo declarado EXISTE en disco, con la convención (WEBP, 780 × 1140, alfa real).
 *   · Un arte suelto no inventa un producto: `bronce`, `plata` y `oro` tienen fichero y NO
 *     tienen entrada en el catálogo, así que NO se declaran y nadie los pinta.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PACK_ART_AVAILABLE, PACK_ART_DIR, packArtPath, packArtwork } from "./packArtwork";
import { PACKS, getPack } from "./packs";
import { IMPORT_MAP } from "../../scripts/pack-art-import";

const ROOT = process.cwd();
const code = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const asset = (packId: string) => join(ROOT, "public", "packs", `pack-${packId}.webp`);

/** Cabecera WEBP: lienzo y bandera de alfa, leídos del fichero (VP8X del contenedor RIFF). */
function webpInfo(file: string): { ancho: number; alto: number; alfa: boolean; bytes: number } {
  const b = readFileSync(file);
  assert.equal(b.subarray(0, 4).toString("ascii"), "RIFF", `${file}: no es RIFF`);
  assert.equal(b.subarray(8, 12).toString("ascii"), "WEBP", `${file}: no es WEBP`);
  const chunk = b.subarray(12, 16).toString("ascii");
  assert.equal(chunk, "VP8X", `${file}: sin cabecera extendida (la escribe el alfa)`);
  return {
    alfa: (b[20] & 0x10) !== 0,
    ancho: b.readUIntLE(24, 3) + 1,
    alto: b.readUIntLE(27, 3) + 1,
    bytes: statSync(file).size,
  };
}

/* ═══════════ LA CORRESPONDENCIA ═══════════ */

test("F5133 A1 · cada arte oficial va a un pack que EXISTE en el catálogo (o a ninguno, declarado)", () => {
  const conProducto = IMPORT_MAP.filter((m) => getPack(m.packId));
  const sinProducto = IMPORT_MAP.filter((m) => !getPack(m.packId));
  /*
   * Packs Base 4.0: los tres escalones de ICON dejaron de ser ficheros huérfanos. Bronce y Plata
   * son los productos de siempre renombrados (por eso su arte va al fichero de su `packId`
   * histórico, `estandar` y `premium`) y Oro es producto nuevo. Ya no queda ningún arte sin dueño.
   */
  assert.deepEqual(conProducto.map((m) => m.packId).sort(),
    ["americas", "champions", "china", "emea", "estandar", "ewc", "icon", "inicial", "masters", "oro",
      "pacific", "premium", "team-fnatic", "team-g2", "team-heretics", "team-karmine", "team-liquid"],
    "los diecisiete artes oficiales apuntan a un producto real");
  assert.deepEqual(sinProducto.map((m) => m.packId), [], "ningún arte oficial sin producto");
});

test("F5133 A2 · lo declarado existe en disco y cumple la convención (WEBP 780×1140 con alfa)", () => {
  for (const id of PACK_ART_AVAILABLE) {
    const f = asset(id);
    assert.ok(existsSync(f), `falta el fichero de ${id}`);
    const i = webpInfo(f);
    assert.equal(i.ancho, 780, `${id}: ancho`);
    assert.equal(i.alto, 1140, `${id}: alto`);
    assert.ok(i.alfa, `${id}: el alfa es obligatorio (se compone sobre fondos distintos)`);
    assert.ok(i.bytes < 400_000, `${id}: ${Math.round(i.bytes / 1024)} KB es demasiado para la web`);
  }
});

test("F5133 A3 · los diez importados están en disco, también los que aún no tienen producto", () => {
  for (const m of IMPORT_MAP) {
    const i = webpInfo(asset(m.packId));
    assert.equal(i.ancho, 780);
    assert.equal(i.alto, 1140);
    assert.ok(i.alfa, `${m.packId}: alfa`);
  }
  assert.equal(new Set(IMPORT_MAP.map((m) => m.packId)).size, IMPORT_MAP.length, "sin packId repetido");
  assert.equal(new Set(IMPORT_MAP.map((m) => m.file)).size, IMPORT_MAP.length, "sin fichero repetido");
});

test("F5133 A4 · ids inexistentes: null, sin adivinar ni caer en otro arte", () => {
  for (const malo of ["", "no-existe", "bronze", "silver", "gold", "mvps", "PREMIUM", "../estandar", "__proto__"]) {
    assert.equal(packArtwork(malo), null, malo);
  }
  assert.equal(packArtPath("estandar"), `${PACK_ART_DIR}/pack-estandar.webp`);
  assert.equal(packArtwork("estandar"), "/packs/pack-estandar.webp");
});

test("F5133 A5 · un pack sin arte propio NO toma prestado otro: se queda en el dibujo procedimental", () => {
  const sinArte = PACKS.filter((p) => !PACK_ART_AVAILABLE.has(p.id));
  for (const p of sinArte) assert.equal(packArtwork(p.id), null, p.id);
  /* Hoy son los sobres de equipo en DRAFT: existen como producto y aún no tienen fichero. */
  assert.ok(sinArte.every((p) => p.id.startsWith("team-")), "solo los de equipo se quedan sin arte");
  assert.ok(sinArte.length > 0, "el caso «sin arte» sigue vivo y probado");
});

/* ═══════════ UNA SOLA FUENTE DE VERDAD ═══════════ */

test("F5133 B1 · nadie construye la ruta a mano: la única que la escribe es packArtwork", () => {
  const ficheros = [
    ["src", "components", "packs", "SealedPack.tsx"],
    ["src", "components", "packs", "packIdentity.ts"],
    ["src", "components", "store", "StoreProducts.tsx"],
    ["src", "components", "store", "StoreHero.tsx"],
    ["src", "components", "store", "PurchaseModal.tsx"],
    ["src", "components", "season", "SeasonRewards.tsx"],
    ["src", "components", "season", "SeasonMissions.tsx"],
    ["src", "components", "packs", "PackStage.tsx"],
  ];
  for (const f of ficheros) {
    const s = code(...f);
    assert.ok(!/["'`]\/packs\/pack-/.test(s), `${f.join("/")}: ruta de arte escrita a mano`);
    assert.ok(!/\.webp["'`]/.test(s.replace(/packArt\w*/g, "")), `${f.join("/")}: fichero de arte escrito a mano`);
  }
});

test("F5133 B2 · la TIENDA pinta el arte por la fuente de verdad", () => {
  const productos = code("src", "components", "store", "StoreProducts.tsx");
  assert.match(productos, /import \{ packArtwork \} from "@\/data\/packArtwork"/);
  assert.match(productos, /packArtwork\(pack\.id\)/);
  assert.match(code("src", "components", "store", "StoreHero.tsx"), /packArtwork\(/);
  assert.match(code("src", "components", "store", "PurchaseModal.tsx"), /packArtwork\(/);
  /* Y la tienda no decide qué se vende: eso sigue en el catálogo, que no toca esta fase. */
  assert.ok(!/price|weights|odds/.test(code("src", "data", "packArtwork.ts")), "el arte no toca economía");
});

test("F5133 B3 · la APERTURA pinta el mismo arte: SealedPack lo toma de la identidad del pack", () => {
  const sealed = code("src", "components", "packs", "SealedPack.tsx");
  assert.match(sealed, /const conArte = !!id\.artwork/);
  assert.match(sealed, /src=\{id\.artwork\}/);
  assert.match(code("src", "components", "packs", "packIdentity.ts"), /artwork: packArtwork\(/);
  /* La estructura que abre el sobre sigue siendo del componente, lleve arte o no. */
  assert.match(sealed, /cutProgress/);
  assert.match(code("src", "components", "packs", "PackStage.tsx"), /<SealedPack/);
});

test("F5133 B4 · TEMPORADA (pase y misiones) pinta el mismo arte, sin cambiar la recompensa", () => {
  const recompensas = code("src", "components", "season", "SeasonRewards.tsx");
  assert.match(recompensas, /packArtwork\(/);
  assert.match(code("src", "components", "season", "SeasonMissions.tsx"), /packArtwork\(/);
  /* El carril y las misiones siguen declarando `packId`: presentación, no contenido. */
  const datos = code("src", "data", "season.ts");
  assert.match(datos, /packId: "premium"/);
  assert.match(datos, /packId: "estandar"/);
  assert.ok(!/packArtwork|\/packs\//.test(datos), "los datos de temporada no saben de imágenes");
});

test("F5133 B5 · el render procedimental ya no pisa el arte oficial", () => {
  const render = code("scripts", "pack-art-render.ts");
  assert.match(render, /IMPORT_MAP/, "la lista protegida sale del propio importador");
  assert.match(render, /const OFICIALES = new Set\(IMPORT_MAP\.map/);
  assert.match(render, /force \? pedidos : pedidos\.filter\(\(s\) => !OFICIALES\.has\(s\.file\)\)/);
});
