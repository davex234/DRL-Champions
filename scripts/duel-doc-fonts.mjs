/**
 * DESCARGA LAS TIPOGRAFÍAS del documento de producto y las deja en `docs/product/fonts/`.
 *
 *   node scripts/duel-doc-fonts.mjs
 *
 * POR QUÉ EXISTE: la API moderna de Google Fonts sirve Inter como fuente VARIABLE, y Chrome no la
 * incrusta al exportar a PDF: el texto caía a Segoe UI. Se piden instancias ESTÁTICAS por peso
 * (API v1) y se guardan en el repositorio, de modo que el documento:
 *   · incrusta de verdad sus dos tipografías,
 *   · se ve igual en cualquier ordenador que abra el PDF,
 *   · y se puede regenerar sin conexión.
 *
 * Ambas familias son SIL Open Font License 1.1.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "docs", "product", "fonts");
mkdirSync(DIR, { recursive: true });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Familias y pesos que usa el documento. Nada más: cada peso extra es peso muerto en el PDF. */
const FAMILIES = [
  // Barlow y no Inter, que es la tipografía de la aplicación: Chrome NO incrusta Inter al exportar
  // a PDF —se comprobó una a una— y el texto caía a una fuente del sistema que además no se puede
  // redistribuir. Barlow se incrusta correctamente, es OFL y es un grotesco del mismo registro.
  { family: "Barlow", weights: [400, 500, 600, 700, 800] },
  { family: "Rajdhani", weights: [500, 600, 700] },
];

/** Solo el subconjunto `latin`: cubre el español entero (á é í ó ú ñ ü ¿ ¡) y pesa la mitad. */
const SUBSETS = ["latin"];

for (const { family, weights } of FAMILIES) {
  const url = `https://fonts.googleapis.com/css?family=${family}:${weights.join(",")}&display=swap`;
  const css = await (await fetch(url, { headers: { "User-Agent": UA } })).text();

  // Los bloques vienen precedidos de un comentario con el nombre del subconjunto.
  const blocks = css.split("/*").slice(1);
  for (const block of blocks) {
    const subset = block.slice(0, block.indexOf("*/")).trim();
    if (!SUBSETS.includes(subset)) continue;
    const weight = Number((block.match(/font-weight:\s*(\d+)/) || [])[1]);
    const src = (block.match(/url\((https:\/\/[^)]+\.woff2)\)/) || [])[1];
    if (!weight || !src || !weights.includes(weight)) continue;

    const name = `${family}-${weight}-${subset}.woff2`;
    const out = join(DIR, name);
    if (existsSync(out)) { console.log(`  = ${name}`); continue; }
    const buf = Buffer.from(await (await fetch(src, { headers: { "User-Agent": UA } })).arrayBuffer());
    writeFileSync(out, buf);
    console.log(`  ↓ ${name} · ${(buf.length / 1024).toFixed(1)} KB`);
  }
}
console.log("[fonts] listas en docs/product/fonts/");
