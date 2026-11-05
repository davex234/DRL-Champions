/**
 * GEN-LATEST (CLI) — genera latest.json + meta.json + files.json. Fina capa sobre los engines
 * (Sign + Artifact + Manifest); se mantiene por compatibilidad con docs/UPDATER.md.
 *
 *   node scripts/gen-latest.mjs --version 0.6.0 --build 12 --channel stable \
 *        --base https://update.drlchampions.com [--date ISO] [--notes "@file"] [--no-bundle]
 */
import { join, basename } from "node:path";
import { copyFileSync } from "node:fs";
import { parseArgs } from "./release/core/args.mjs";
import { ensureDir, readText } from "./release/core/fsx.mjs";
import SignEngine from "./release/sign-engine.mjs";
import ArtifactEngine from "./release/artifact-engine.mjs";
import ManifestEngine from "./release/manifest-engine.mjs";

const { has, opt } = parseArgs();
const ROOT = process.cwd();
const version = opt("version") ?? JSON.parse(readText(join(ROOT, "package.json"))).version;
const build = Number(opt("build", "0"));
const channel = opt("channel", "stable");
const baseUrl = opt("base", "https://update.drlchampions.com");
const pubDate = opt("date", new Date().toISOString());
const noBundle = has("no-bundle");
let notes = opt("notes", `DRL Champions v${version}`);
if (notes.startsWith("@")) notes = readText(notes.slice(1));

const DEST = ensureDir(join(ROOT, "dist", "update", channel));
const OUT = join(ROOT, "out");

const signatures = !noBundle ? SignEngine.collectSignatures(ArtifactEngine.primaryBundleDir(ROOT) ?? "") : [];
if (!noBundle && signatures.length === 0) {
  console.error("[gen-latest] ❌ No hay artefactos firmados (.sig). Compila con la clave o usa --no-bundle.");
  process.exit(1);
}
for (const s of signatures) copyFileSync(s.artifact, join(DEST, basename(s.artifact)));

const latest = signatures.length ? ManifestEngine.buildLatest({ version, notes, pubDate, channel, baseUrl, artifacts: signatures }) : null;
const meta = ManifestEngine.buildMeta({ version, build, notes, pubDate, artifacts: signatures });
const files = ManifestEngine.buildFiles({ version, channel, generatedAt: pubDate, files: ManifestEngine.filesFromResources(OUT) });
const written = ManifestEngine.writeManifests(DEST, { latest, meta, files });

console.log(`[gen-latest] ✓ ${Object.keys(written).join(", ")} (${files.files.length} recursos) → dist/update/${channel}/`);
if (!latest) console.log("[gen-latest] (sin latest.json: --no-bundle o sin firmas)");
