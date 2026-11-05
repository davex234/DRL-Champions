/**
 * CI VERIFY RUNNER — ejecuta TODOS los `scripts/*-verify.ts` y sale con código !=0 si alguno falla.
 *
 * Cada verify fija `process.exitCode = 1` cuando una comprobación falla (gate real, no decorativo).
 * Este runner los agrega en un solo comando para CI (`npm run verify:all`) y para uso local.
 *
 * VERIFY_EXCLUDE="a-verify.ts,b-verify.ts" permite excluir verifies dependientes del entorno
 * (p. ej. los que requieren artefactos de build de escritorio).
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const DIR = "scripts";
const files = readdirSync(DIR).filter((f) => f.endsWith("-verify.ts")).sort();
const exclude = new Set((process.env.VERIFY_EXCLUDE ?? "").split(",").map((s) => s.trim()).filter(Boolean));

const failed = [];
const skipped = [];
for (const f of files) {
  if (exclude.has(f)) { skipped.push(f); console.log(`⏭  SKIP  ${f}`); continue; }
  const r = spawnSync("npx", ["tsx", join(DIR, f)], { encoding: "utf8", shell: true });
  if (r.status === 0) {
    console.log(`✓  PASS  ${f}`);
  } else {
    failed.push(f);
    console.log(`✗  FAIL  ${f}`);
    if (r.stdout) process.stdout.write(r.stdout.split("\n").slice(-12).join("\n") + "\n");
    if (r.stderr) process.stderr.write(r.stderr.split("\n").slice(-12).join("\n") + "\n");
  }
}

const ran = files.length - skipped.length;
console.log(`\n${failed.length === 0 ? "✅" : "❌"} verifies: ${ran - failed.length}/${ran} passed` + (skipped.length ? ` (${skipped.length} skipped)` : ""));
if (failed.length) {
  console.log("FAILED:\n" + failed.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
