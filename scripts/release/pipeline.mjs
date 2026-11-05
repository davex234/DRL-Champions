/**
 * RELEASE PIPELINE — orquesta los engines en orden, SIN conocer sus detalles internos:
 *
 *   Version → Build → Sign → Manifest → Artifacts → Release
 *
 * Cada paso delega en un engine de responsabilidad única. Devuelve el objeto `Release`
 * (no publica: eso será una fase futura que consuma este objeto).
 */
import { join } from "node:path";
import VersionEngine from "./version-engine.mjs";
import BuildEngine from "./build-engine.mjs";
import SignEngine from "./sign-engine.mjs";
import ArtifactEngine from "./artifact-engine.mjs";
import ManifestEngine from "./manifest-engine.mjs";
import PublishEngine from "./publish-engine.mjs";

const log = (m) => console.log(`[pipeline] ${m}`);

export async function run(opts = {}) {
  const root = opts.root ?? process.cwd();
  const baseUrl = opts.baseUrl ?? "https://update.drlchampions.com";
  const date = opts.date ?? new Date().toISOString();
  // Hook opcional de fases (lo consume el runner de CI / dashboard). No acopla el pipeline.
  const onPhase = typeof opts.onPhase === "function" ? opts.onPhase : () => {};
  const prev = VersionEngine.readVersion(root);
  const channel = opts.channel ?? prev.channel ?? "stable";
  const level = opts.level ?? "patch";
  onPhase("running", { channel, level });

  // 1) VERSION — detectar cambios
  const { cur, hasChanges, delta } = VersionEngine.detectChanges(root, channel);
  if (!hasChanges && !opts.force) {
    log("No changes detected. Release cancelled.");
    return { cancelled: true, version: VersionEngine.fullVersion(prev), channel };
  }
  const next = VersionEngine.nextVersion(root, level, channel);
  const notesInfo = VersionEngine.releaseNotes(delta);
  const notes = opts.notes ?? VersionEngine.changelogText({ version: next.version + "+" + next.build, channel, date, bullets: notesInfo.bullets, totalFiles: notesInfo.totalFiles });
  log(`${VersionEngine.fullVersion(prev)} → ${VersionEngine.fullVersion(next)} (${channel})`);

  if (opts.dry) {
    return { dry: true, prev, next, channel, modules: notesInfo.modules, notes, delta };
  }

  // 2) VERSION — aplicar al proyecto (único escritor de versiones)
  VersionEngine.applyVersion(root, next);

  // 3) BUILD
  onPhase("building", { full: VersionEngine.fullVersion(next) });
  BuildEngine.buildAll({ web: !opts.skipWeb, desktop: true, bundle: !opts.noBundle });

  // 4) SIGN + ARTIFACTS — descubrir lo generado (sin rutas hardcodeadas)
  onPhase("signing", {});
  const bundleDir = ArtifactEngine.primaryBundleDir(root);
  const signatures = bundleDir ? SignEngine.collectSignatures(bundleDir) : [];
  const discovered = ArtifactEngine.discover(root);
  log(`artefactos: ${discovered.installers.length} instaladores · ${signatures.length} firmas`);

  // 5) MANIFEST — latest (si hay bundle firmado) + meta + files
  onPhase("manifests", { signatures: signatures.length });
  const outDir = join(root, "out");
  const dest = join(root, "dist", "update", channel);
  const filesEntries = ManifestEngine.filesFromResources(outDir);
  const filesManifest = ManifestEngine.buildFiles({ version: next.version, channel, generatedAt: date, files: filesEntries });
  const meta = ManifestEngine.buildMeta({ version: next.version, build: next.build, notes, pubDate: date, artifacts: signatures });
  let latest = null;
  if (!opts.noBundle && signatures.length > 0) {
    latest = ManifestEngine.buildLatest({ version: next.version, notes, pubDate: date, channel, baseUrl, artifacts: signatures });
  }
  const written = ManifestEngine.writeManifests(dest, { latest, meta, files: filesManifest });
  log(`manifiestos: ${Object.keys(written).join(", ") || "—"} (${filesEntries.length} recursos)`);

  // 6) INTEGRITY
  const integrity = ManifestEngine.verifyResources(outDir, filesManifest);
  if (!integrity.ok) throw new Error(`Integridad: ${integrity.mismatches.length} recursos no coinciden`);
  log(`integridad OK (${integrity.checked} recursos)`);

  // 7) RELEASE — ensamblar objeto + stage local (NO publica en servidor)
  const release = PublishEngine.assembleRelease({
    version: next.version, build: next.build, channel, date,
    commit: VersionEngine.gitCommit(root), hash: cur.hash, notes, baseUrl,
    installers: signatures.map((s) => ({ name: s.name, size: s.size })),
    signatures,
    manifests: written,
  });
  PublishEngine.stage(release, dest, { installers: signatures.map((s) => ({ name: s.name, path: s.artifact })) });

  // 8) VERSION — registrar la release (changelog + huella)
  VersionEngine.recordRelease(root, { version: next.version, build: next.build, channel, date, hash: cur.hash, files: cur.files, notes });

  onPhase("ready", { full: release.full });
  log(`✅ Release ${release.full} (${channel}) — módulos: ${notesInfo.modules.join(", ") || "—"}`);
  return { release, written, integrity, modules: notesInfo.modules };
}

export const ReleasePipeline = { run };
export default ReleasePipeline;
