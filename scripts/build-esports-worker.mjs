/**
 * BUILD REPRODUCIBLE DEL WORKER (Fase 24.8) — `node scripts/build-esports-worker.mjs`
 *
 * Empaqueta `scripts/esports-autosync-worker.ts` y TODO lo que importa (core, importer-vlr,
 * lifecycle de Pick'ems, rewards, supabase-js) en UN fichero JavaScript autocontenido:
 *
 *   deploy/drlcards-sync/dist/worker.cjs
 *
 * Nada de Next, React ni frontend entra: esbuild solo sigue los imports reales del entrypoint.
 * Sin dependencias de ejecución en el VPS (`@supabase/supabase-js` va dentro): solo hace falta
 * Node 22. Además escribe el MANIFEST con la lista exacta de ficheros fuente que entraron, su
 * SHA-256, el hash del bundle y un identificador de build `<HEAD>+worker.<sha8>` que no es un
 * commit: declara qué ficheros sin commitear formaban parte.
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "deploy", "drlcards-sync");
const DIST = join(OUT_DIR, "dist");
const ENTRY = "scripts/esports-autosync-worker.ts";
const NODE_TARGET = "node22";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const git = (cmd) => { try { return execSync(`git ${cmd}`, { encoding: "utf8" }).trim(); } catch { return "?"; } };

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  platform: "node",
  target: NODE_TARGET,
  format: "cjs",
  outfile: join(DIST, "worker.cjs"),
  metafile: true,
  sourcemap: false,
  minify: false,
  legalComments: "none",
  logLevel: "warning",
  define: { "process.env.NODE_ENV": '"production"' },
  banner: { js: "#!/usr/bin/env node\n/* NEXUS DRLCards · esports auto-sync worker (Fase 24.8) · build reproducible: ver MANIFEST.txt */" },
});

const inputs = Object.keys(result.metafile.inputs).sort();
const sources = inputs.filter((p) => !p.startsWith("node_modules/"));
const deps = [...new Set(inputs.filter((p) => p.startsWith("node_modules/")).map((p) => p.split("/").slice(0, p.startsWith("node_modules/@") ? 3 : 2).join("/")))].sort();
const forbidden = sources.filter((p) => /^src\/(app|components|store|design)\//.test(p) || /react|next\//.test(p));
if (forbidden.length) throw new Error(`el worker arrastra frontend: ${forbidden.join(", ")}`);

const head = git("rev-parse --short HEAD");
const dirty = new Set(git("status --porcelain").split("\n").map((l) => l.slice(3).trim()).filter(Boolean));
const lines = sources.map((p) => `${sha256(readFileSync(join(ROOT, p)))}  ${p}${dirty.has(p) ? "  (sin commit)" : ""}`);
const manifestHash = sha256(lines.join("\n")).slice(0, 8);
const bundle = readFileSync(join(DIST, "worker.cjs"));
const bundleHash = sha256(bundle);
const buildId = `${head}+worker.${manifestHash}`;
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
const depVersions = deps.map((d) => { const name = d.replace(/^node_modules\//, ""); const v = lock.packages?.[d]?.version ?? "?"; return `${name}@${v}`; });

const manifest = [
  `# NEXUS DRLCards · esports auto-sync worker · MANIFEST`,
  `build_id: ${buildId}`,
  `built_at: ${new Date().toISOString()}`,
  `git_head: ${head}`,
  `git_branch: ${git("branch --show-current")}`,
  `entry: ${ENTRY}`,
  `node_target: ${NODE_TARGET}`,
  `project_version: ${pkg.version}`,
  `bundle: dist/worker.cjs  sha256=${bundleHash}  bytes=${bundle.length}`,
  `bundled_dependencies: ${depVersions.join(", ")}`,
  `source_files: ${sources.length} (${sources.filter((p) => dirty.has(p)).length} sin commit)`,
  ``,
  `# sha256  path`,
  ...lines,
].join("\n") + "\n";
writeFileSync(join(OUT_DIR, "MANIFEST.txt"), manifest);
writeFileSync(join(OUT_DIR, "SHA256SUMS"), `${bundleHash}  dist/worker.cjs\n${sha256(manifest)}  MANIFEST.txt\n`);
writeFileSync(join(OUT_DIR, "package.json"), JSON.stringify({
  name: "drlcards-esports-sync-worker", version: `${pkg.version}+${manifestHash}`, private: true,
  description: "NEXUS DRLCards · worker oneshot del auto-sync esports (bundle autocontenido, sin dependencias)",
  engines: { node: ">=22" }, scripts: { sync: "node dist/worker.cjs", "dry-run": "node dist/worker.cjs --dry-run" },
}, null, 2) + "\n");

console.log(`build_id=${buildId}`);
console.log(`bundle=${relative(ROOT, join(DIST, "worker.cjs"))} bytes=${bundle.length} sha256=${bundleHash}`);
console.log(`sources=${sources.length} (sin commit: ${sources.filter((p) => dirty.has(p)).length}) · deps empaquetadas: ${depVersions.join(", ")}`);
