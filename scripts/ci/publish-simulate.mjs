/**
 * CI/PUBLISH-SIMULATE — simula una PUBLICACIÓN COMPLETA del Build Cloud (Fase 3) y verifica que
 * los ficheros que terminan en el provider son BYTE A BYTE idénticos a los artefactos generados
 * en `dist/update/<canal>/`.
 *
 * Ejecuta run-pipeline (--no-bundle) forzando el provider `local` a un directorio temporal, y
 * compara cada fichero publicado con su origen staged. No deja el repo bumpeado (snapshot/restore).
 *
 *   node scripts/ci/publish-simulate.mjs   (o: npm run publish:simulate)
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const FIXED_DATE = "2026-06-30T00:00:00.000Z";
const CHANNEL = "stable";
const SNAP = [
  "version.json", "package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml",
  "src/platform/version.ts", "CHANGELOG.md", ".release/last.stable.json",
];
const snapshot = () => SNAP.map((p) => ({ abs: join(ROOT, p), buf: existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p)) : null }));
const restore = (snap) => snap.forEach(({ abs, buf }) => { if (buf === null) { if (existsSync(abs)) rmSync(abs); } else writeFileSync(abs, buf); });
const sha = (p) => readFileSync(p);

console.log("━━━ CI PUBLISH-SIMULATE — publicado vs generado (byte a byte) ━━━\n");
const PUB_DIR = mkdtempSync(join(tmpdir(), "drl-pubsim-"));
const original = snapshot();
let pass = true;
try {
  console.log(`[1/2] run-pipeline → provider 'local' en ${PUB_DIR}…`);
  const r = spawnSync("node", ["scripts/ci/run-pipeline.mjs", "--no-bundle", "--none", "--channel", CHANNEL, "--date", FIXED_DATE], {
    stdio: "inherit", shell: false,
    env: { ...process.env, DRL_PUBLISH_PROVIDER: "local", DRL_PUBLISH_LOCAL_DIR: PUB_DIR },
  });
  if ((r.status ?? 1) !== 0) throw new Error("run-pipeline falló");

  console.log("\n[2/2] Comparando artefactos generados vs publicados…");
  const staged = join(ROOT, "dist", "update", CHANNEL);
  const published = join(PUB_DIR, CHANNEL);
  const PUBLISHABLE = /\.(json|md|exe|msi)$/i;
  const stagedFiles = readdirSync(staged).filter((n) => PUBLISHABLE.test(n) && statSync(join(staged, n)).isFile());

  let compared = 0, identical = 0;
  for (const name of stagedFiles) {
    const pub = join(published, name);
    if (!existsSync(pub)) { console.log(`  ✗ ${name} — NO publicado`); pass = false; continue; }
    compared++;
    if (Buffer.compare(sha(join(staged, name)), sha(pub)) === 0) { identical++; console.log(`  ✓ ${name}`); }
    else { console.log(`  ✗ ${name} — difiere`); pass = false; }
  }
  // Comprobaciones de accesibilidad exigidas por la fase.
  for (const must of ["latest.json", "meta.json", "files.json", "release.json"]) {
    const present = existsSync(join(published, must));
    if (must === "latest.json" && !present) { console.log(`  ⚠ ${must} ausente (build --no-bundle, esperado)`); continue; }
    console.log(`  ${present ? "✓" : "✗"} accesible: ${must}`);
    if (!present && must !== "latest.json") pass = false;
  }
  // Anillo de rollback creado.
  const ring = existsSync(join(published, "releases", "history.json"));
  console.log(`  ${ring ? "✓" : "✗"} anillo de rollback (releases/history.json)`);
  if (!ring) pass = false;

  console.log(`\n  ${identical}/${compared} ficheros byte-idénticos`);
} catch (e) {
  console.error(`\n❌ ${e.message}`);
  pass = false;
} finally {
  restore(original);
  try { rmSync(PUB_DIR, { recursive: true, force: true }); } catch { /* */ }
}

console.log(`\n━━━ ${pass ? "✓ Publicación verificada (publicado == generado)" : "✗ Divergencia en la publicación"} ━━━\n`);
process.exit(pass ? 0 : 1);
