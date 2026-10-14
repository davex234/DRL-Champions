/**
 * FIXTURES DE PRUEBA QUE LA RELEASE NO LLEVA — lista y tar para la puerta de una candidata.
 *
 *   node scripts/ops/release-test-fixtures.mjs <salida.tar>
 *
 * Por qué existe: las releases excluyen `docs/` y `personajes/` por política (`OUT_OF_RELEASE` en
 * `_i18n-rc-overlay.mjs`: no son parte de la app). Pero ocho pruebas leen ficheros de ahí —SQL de rollback y de
 * propuestas, dos instantáneas JSON de distribución y los originales del arte de agentes— y en la puerta de cada
 * candidata (que ejecuta `npm test` sobre la fuente de la release) fallaban con ENOENT. No es un fallo del producto:
 * es que a la fuente de la release le faltan los datos de las pruebas.
 *
 * Arreglo sin tocar ni las pruebas ni la release: la puerta compila la release TAL CUAL y, solo después del build y del
 * typecheck, extrae al lado estos ficheros del repositorio para ejecutar las pruebas. La lista sale de las propias
 * pruebas (rutas literales `docs/…` y `join(…, "docs", …)`) más `personajes/` y `docs/operations/`, y se comprueba que
 * cada fichero exista y esté en git: si una prueba nueva lee algo de `docs/` que no está, esto falla en voz alta.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
if (!out) throw new Error("uso: release-test-fixtures.mjs <salida.tar>");
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28 });
const tracked = new Set(git("ls-files", "-z").split("\0").filter(Boolean));
const tests = [...tracked].filter((f) => /^src\/.*\.test\.tsx?$/.test(f));

const wanted = new Set();
for (const f of tests) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/["'`](docs\/[^"'`$]+\.[a-z0-9]+)["'`]/g)) wanted.add(m[1]);
  for (const m of src.matchAll(/join\([^)]*?"docs"((?:,\s*"[^"]+")+)\)/g)) wanted.add(["docs", ...[...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])].join("/"));
}
// Carpetas que las pruebas recorren (no por ruta literal): originales del arte de agentes y SQL de operaciones.
for (const f of tracked) if (/^(personajes\/|docs\/operations\/(rollback|proposals)\/)/.test(f)) wanted.add(f);

const list = [...wanted].sort();
const missing = list.filter((f) => !tracked.has(f) || !existsSync(join(process.cwd(), f)));
if (missing.length) { console.error("Las pruebas leen ficheros que no están en git:\n" + missing.join("\n")); process.exit(1); }
writeFileSync(`${out}.txt`, list.join("\n") + "\n");
execFileSync("tar", ["-cf", out, "-T", `${out}.txt`]);
console.log(`fixtures: ${list.length} ficheros → ${out}`);
