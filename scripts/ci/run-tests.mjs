/**
 * CI/RUN-TESTS — ejecuta la suite de tests unitarios del proyecto (ficheros `*.test.ts` que
 * usan el runner nativo `node:test`), cargados con tsx. Sin dependencias nuevas.
 *
 *   npm test
 */
import { spawnSync } from "node:child_process";
import { walk } from "../release/core/fsx.mjs";
import { join } from "node:path";

const ROOT = process.cwd();
const tests = walk(join(ROOT, "src")).filter((p) => /\.test\.tsx?$/.test(p));

if (tests.length === 0) {
  console.log("[tests] no hay ficheros *.test.ts");
  process.exit(0);
}
console.log(`[tests] ejecutando ${tests.length} ficheros con node:test (tsx)…`);
const r = spawnSync("node", ["--import", "tsx", "--test", ...tests], { stdio: "inherit", shell: false });
process.exit(r.status ?? 1);
