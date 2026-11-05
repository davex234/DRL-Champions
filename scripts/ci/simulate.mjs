/**
 * CI/SIMULATE — simula la ejecución del workflow en local y verifica que los artefactos del
 * Build Cloud (run-pipeline) COINCIDEN EXACTAMENTE con los de `npm run release`.
 *
 * Como ambos reutilizan el MISMO ReleasePipeline, con la misma versión de partida y la misma
 * fecha el resultado es byte-idéntico. Para no dejar el repo bumpeado, hace snapshot/restore
 * de los ficheros de versión entre ejecuciones.
 *
 *   node scripts/ci/simulate.mjs   (o: npm run ci:simulate)
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FIXED_DATE = "2026-06-30T00:00:00.000Z";
const SNAP = [
  "version.json", "package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml",
  "src/platform/version.ts", "CHANGELOG.md", ".release/last.stable.json",
];

const snapshot = () => SNAP.map((p) => ({ p, abs: join(ROOT, p), buf: existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p)) : null }));
const restore = (snap) => snap.forEach(({ abs, buf }) => { if (buf === null) { if (existsSync(abs)) rmSync(abs); } else writeFileSync(abs, buf); });
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false, env: process.env });
  if ((r.status ?? 1) !== 0) throw new Error(`falló: ${cmd} ${args.join(" ")}`);
};
const readArtifacts = () => {
  const dir = join(ROOT, "dist", "update", "stable");
  return {
    files: readFileSync(join(dir, "files.json"), "utf8"),
    meta: readFileSync(join(dir, "meta.json"), "utf8"),
  };
};

console.log("━━━ CI SIMULATE — artefactos CI vs npm run release ━━━\n");
const original = snapshot();
let pass = true;
try {
  console.log("[1/2] scripts/release.mjs (--no-bundle --none --force) [= npm run release]…");
  run("node", ["scripts/release.mjs", "--no-bundle", "--none", "--force", "--date", FIXED_DATE]);
  const A = readArtifacts();
  restore(original);

  console.log("\n[2/2] scripts/ci/run-pipeline.mjs (--no-bundle --none --no-publish)…");
  run("node", ["scripts/ci/run-pipeline.mjs", "--no-bundle", "--none", "--no-publish", "--date", FIXED_DATE]);
  const B = readArtifacts();
  restore(original);

  const okFiles = A.files === B.files;
  const okMeta = A.meta === B.meta;
  console.log("\n── Comparación ──");
  console.log(`  files.json idéntico: ${okFiles ? "✓" : "✗"}`);
  console.log(`  meta.json idéntico:  ${okMeta ? "✓" : "✗"}`);
  pass = okFiles && okMeta;
} catch (e) {
  console.error(`\n❌ ${e.message}`);
  pass = false;
} finally {
  restore(original);
}

console.log(`\n━━━ ${pass ? "✓ Artefactos coinciden (CI == npm run release)" : "✗ Divergencia detectada"} ━━━\n`);
process.exit(pass ? 0 : 1);
