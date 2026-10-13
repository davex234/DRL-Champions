// DRLCards · escritor de logs con rotación (runtime Windows). Lee stdin (stdout+stderr de `next start`) y lo escribe
// en el fichero indicado; al pasar de MAX_BYTES rota a .1 … .KEEP (el más viejo se descarta). Sin dependencias.
//   node drlcards-logpipe.mjs <fichero.log> [maxMB=10] [keep=5]
import { appendFileSync, existsSync, renameSync, rmSync, statSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [file, maxMb = "10", keepArg = "5"] = process.argv.slice(2);
if (!file) { console.error("uso: drlcards-logpipe.mjs <fichero> [maxMB] [keep]"); process.exit(2); }
const MAX = Number(maxMb) * 1024 * 1024;
const KEEP = Number(keepArg);
mkdirSync(dirname(file), { recursive: true });
let size = existsSync(file) ? statSync(file).size : 0;

function rotate() {
  if (existsSync(`${file}.${KEEP}`)) rmSync(`${file}.${KEEP}`);
  for (let i = KEEP - 1; i >= 1; i--) if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`);
  if (existsSync(file)) renameSync(file, `${file}.1`);
  size = 0;
}

process.stdin.on("data", (chunk) => {
  if (size + chunk.length > MAX) rotate();
  appendFileSync(file, chunk);
  size += chunk.length;
});
process.stdin.on("end", () => process.exit(0));
