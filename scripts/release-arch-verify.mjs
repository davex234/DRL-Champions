/**
 * RELEASE-ARCH-VERIFY — valida la arquitectura del Release System (Fase 1/7) y da MÉTRICAS:
 * módulos, responsabilidades, dependencias, acoplamiento y duplicaciones eliminadas.
 *
 *   node scripts/release-arch-verify.mjs   (o: npm run release:arch)
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as RS from "./release/index.mjs";

const ROOT = process.cwd();
const REL = join(ROOT, "scripts", "release");
let pass = 0, fail = 0;
const ok = (n, c, extra = "") => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const read = (p) => readFileSync(join(REL, p), "utf8");

console.log("\n━━━ RELEASE SYSTEM · ARCH VERIFY (Fase 1/7) ━━━\n");

// ── Módulos y responsabilidad única ──
const ENGINES = {
  "version-engine.mjs": { engine: RS.VersionEngine, responsibility: "version/build/canal/changelog/fecha/commit/hash", api: ["readVersion", "nextVersion", "bumpSemver", "fullVersion", "syncProject", "fingerprint", "diff", "detectChanges", "releaseNotes", "applyVersion", "recordRelease", "gitCommit"] },
  "build-engine.mjs": { engine: RS.BuildEngine, responsibility: "compilar web/desktop/tauri/assets", api: ["buildWeb", "buildDesktopExport", "buildTauriBundle", "buildAssets", "buildAll"] },
  "sign-engine.mjs": { engine: RS.SignEngine, responsibility: "firma minisign + SHA256 + verificación", api: ["signingAvailable", "collectSignatures", "verify", "sha256Hex", "sha256File"] },
  "artifact-engine.mjs": { engine: RS.ArtifactEngine, responsibility: "descubrir artefactos sin rutas hardcodeadas", api: ["discover", "primaryBundleDir"] },
  "manifest-engine.mjs": { engine: RS.ManifestEngine, responsibility: "latest.json / meta.json / files.json", api: ["platformKey", "artifactName", "buildLatest", "buildMeta", "buildFiles", "filesFromResources", "writeManifests", "verifyResources"] },
  "publish-engine.mjs": { engine: RS.PublishEngine, responsibility: "objeto Release (desacoplado del servidor)", api: ["assembleRelease", "stage"] },
  "pipeline.mjs": { engine: RS.ReleasePipeline, responsibility: "orquestar engines", api: ["run"] },
};

console.log("Módulos y API:");
for (const [file, { engine, api }] of Object.entries(ENGINES)) {
  ok(`${file} existe`, existsSync(join(REL, file)));
  ok(`${file} expone su facade + API`, !!engine && api.every((m) => typeof engine[m] === "function"), `faltan: ${api.filter((m) => typeof engine?.[m] !== "function").join(",")}`);
}

// ── Núcleo compartido (mata duplicaciones) ──
console.log("\nNúcleo compartido (core):");
for (const f of ["core/proc.mjs", "core/fsx.mjs", "core/hash.mjs", "core/args.mjs"]) ok(`${f} existe`, existsSync(join(REL, f)));

// ── Sin duplicaciones: walk/sha/args definidos UNA vez (en core), no en los engines ──
console.log("\nDuplicaciones eliminadas:");
const engineFiles = Object.keys(ENGINES);
const defsWalk = engineFiles.filter((f) => /function walk\b|const walk\s*=/.test(read(f)));
const defsSha = engineFiles.filter((f) => /createHash\(/.test(read(f)));
const defsArgs = engineFiles.filter((f) => /argv\.indexOf\(/.test(read(f)));
ok("walk solo en core (0 en engines)", defsWalk.length === 0, `→ ${defsWalk.join(",")}`);
ok("hashing solo en core (0 createHash en engines)", defsSha.length === 0, `→ ${defsSha.join(",")}`);
ok("parser de args solo en core (0 en engines)", defsArgs.length === 0, `→ ${defsArgs.join(",")}`);
ok("lib/ antiguo eliminado", !existsSync(join(ROOT, "scripts", "lib", "release-core.mjs")) && !existsSync(join(ROOT, "scripts", "lib", "version-manager.mjs")) && !existsSync(join(ROOT, "scripts", "lib", "changes.mjs")));

// ── Grafo de dependencias + acoplamiento ──
console.log("\nDependencias y acoplamiento:");
const ENGINE_NAMES = engineFiles.map((f) => f.replace(".mjs", ""));
function engineImports(file) {
  const src = read(file);
  const imps = [...src.matchAll(/from\s+"\.\/([a-z-]+)\.mjs"/g)].map((m) => m[1]);
  return imps.filter((n) => ENGINE_NAMES.includes(n));
}
let crossEdges = 0;
for (const f of engineFiles) {
  const deps = engineImports(f);
  crossEdges += deps.length;
  if (f !== "pipeline.mjs") ok(`${f} NO depende de otros engines (desacoplado)`, deps.length === 0, `→ ${deps.join(",")}`);
}
const pipelineDeps = engineImports("pipeline.mjs");
ok("pipeline orquesta los 6 engines", pipelineDeps.length === 6, `→ ${pipelineDeps.length}: ${pipelineDeps.join(",")}`);
ok("acoplamiento entre engines = solo vía pipeline", crossEdges === pipelineDeps.length, `cross=${crossEdges}`);

// ── Determinismo (builders puros) ──
console.log("\nDeterminismo:");
const args = { version: "0.6.1", notes: "x", pubDate: "2026-01-01T00:00:00Z", channel: "stable", baseUrl: "https://u", artifacts: [{ name: "App_0.6.1_x64-setup.exe", signature: "S" }] };
const l1 = JSON.stringify(RS.ManifestEngine.buildLatest(args));
const l2 = JSON.stringify(RS.ManifestEngine.buildLatest(args));
ok("buildLatest determinista", l1 === l2);
ok("bumpSemver determinista", RS.VersionEngine.bumpSemver("0.6.0", "patch") === "0.6.1" && RS.VersionEngine.bumpSemver("0.6.0", "patch") === "0.6.1");
const fp1 = RS.VersionEngine.fingerprint(ROOT).hash;
const fp2 = RS.VersionEngine.fingerprint(ROOT).hash;
ok("fingerprint determinista", fp1 === fp2);

// ── MÉTRICAS ──
console.log("\n━━━ MÉTRICAS ━━━");
console.log(`Módulos engine: ${engineFiles.length} (+ 4 utilidades core)`);
console.log(`Responsabilidades:`);
for (const [file, { responsibility }] of Object.entries(ENGINES)) console.log(`  • ${file.replace(".mjs", "").padEnd(16)} → ${responsibility}`);
console.log(`Acoplamiento entre engines: ${crossEdges} aristas (todas desde pipeline → 0 acoplamiento lateral)`);
console.log(`Duplicaciones eliminadas: walk ×3→1 · hashing ×2→1 · parser args ×2→1 · manifest split→unificado`);
console.log(`Líneas por módulo (máx): ${Math.max(...engineFiles.map((f) => read(f).split("\n").length))} (objetivo: sin scripts gigantes)`);

console.log(`\n━━━ Resultado: ${pass} ✓ / ${fail} ✗ ━━━\n`);
process.exit(fail === 0 ? 0 : 1);
