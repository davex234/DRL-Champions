/**
 * CI/RUN-TESTS — ejecuta la suite de tests unitarios del proyecto (ficheros `*.test.ts` que
 * usan el runner nativo `node:test`), cargados con tsx. Sin dependencias nuevas.
 *
 *   npm test
 */
import { spawnSync } from "node:child_process";
import { walk } from "../release/core/fsx.mjs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
// Rutas RELATIVAS a la raíz. Con absolutas, los ~370 ficheros suman ~38 700 caracteres y en Windows superan el límite
// de 32 767 de la línea de comandos en cuanto el repo vive en una ruta larga: `spawnSync` falla con ENAMETOOLONG y el
// runner salía con 1 sin ejecutar ningún test. Relativas son ~15 000. En Linux (CI) no cambia nada.
const tests = walk(join(ROOT, "src")).filter((p) => /\.test\.tsx?$/.test(p)).map((p) => relative(ROOT, p));

if (tests.length === 0) {
  console.log("[tests] no hay ficheros *.test.ts");
  process.exit(0);
}
console.log(`[tests] ejecutando ${tests.length} ficheros con node:test (tsx)…`);
const r = spawnSync("node", ["--import", "tsx", "--test", ...tests], { stdio: "inherit", shell: false, cwd: ROOT });
// Si el proceso ni siquiera arranca (p. ej. ENAMETOOLONG), decirlo: antes salía con 1 en silencio.
if (r.error) console.error(`[tests] no se pudo lanzar node --test: ${r.error.code ?? r.error.message}`);
process.exit(r.status ?? 1);
