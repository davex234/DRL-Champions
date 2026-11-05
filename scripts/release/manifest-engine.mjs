/**
 * MANIFEST ENGINE — toda la lógica de manifiestos vive aquí:
 *   - latest.json  (lo consume el updater OFICIAL de Tauri; estricto, firmado)
 *   - meta.json    (metadatos para el launcher: versión/build/tamaño/notas)
 *   - files.json   (integridad SHA256 de los recursos → verificar/reparar)
 *
 * (Absorbe los builders puros del antiguo lib/release-core.mjs y la composición de gen-latest.)
 * Builders PUROS (deterministas) + escritura/verificación separadas.
 */
import { join, relative } from "node:path";
import { walk, writeJson, readBytes, ensureDir } from "./core/fsx.mjs";
import { sha256Hex } from "./core/hash.mjs";

// ── plataforma de un artefacto (lo que espera Tauri) ──
export function platformKey(fileName) {
  const f = fileName.toLowerCase();
  if (f.endsWith(".nsis.zip") || f.endsWith("-setup.exe") || f.endsWith(".exe")) return "windows-x86_64";
  if (f.endsWith(".msi") || f.endsWith(".msi.zip")) return "windows-x86_64";
  if (f.endsWith(".app.tar.gz") || f.endsWith(".app.tar.gz.sig")) return f.includes("aarch64") || f.includes("arm64") ? "darwin-aarch64" : "darwin-x86_64";
  if (f.endsWith(".appimage") || f.endsWith(".appimage.tar.gz")) return "linux-x86_64";
  return null;
}
export const artifactName = (sigName) => sigName.replace(/\.sig$/i, "");

// ── builders PUROS ──
/** latest.json del updater de Tauri. `artifacts`: [{name, signature}]. */
export function buildLatest({ version, notes = "", pubDate, channel, baseUrl, artifacts }) {
  if (!version) throw new Error("buildLatest: falta version");
  if (!pubDate) throw new Error("buildLatest: falta pubDate");
  const base = `${String(baseUrl).replace(/\/$/, "")}/${channel}`;
  const platforms = {};
  for (const a of artifacts) {
    const key = platformKey(a.name);
    if (!key || platforms[key]) continue;
    platforms[key] = { signature: a.signature, url: `${base}/${encodeURIComponent(a.name)}` };
  }
  if (Object.keys(platforms).length === 0) throw new Error("buildLatest: ningún artefacto válido (¿faltan .sig?)");
  return { version, notes, pub_date: pubDate, platforms };
}

/** meta.json (no lo consume Tauri; lo lee el launcher). `artifacts`: [{name, size}]. */
export function buildMeta({ version, build, notes = "", pubDate, artifacts = [] }) {
  const platforms = {};
  for (const a of artifacts) {
    const key = platformKey(a.name);
    if (key && !platforms[key]) platforms[key] = { size: a.size };
  }
  return { version, build, full: `${version}+${build}`, pub_date: pubDate, notes, platforms };
}

/** files.json de integridad. `files`: [{path, sha256, size}] (se ordena). */
export function buildFiles({ version, channel, generatedAt, files }) {
  return { version, channel, generatedAt, files: files.slice().sort((a, b) => a.path.localeCompare(b.path)) };
}

/** Calcula las entradas de integridad de un directorio de recursos (p.ej. out/). */
export function filesFromResources(outDir) {
  return walk(outDir).map((abs) => {
    const bytes = readBytes(abs);
    return { path: relative(outDir, abs).split("\\").join("/"), sha256: sha256Hex(bytes), size: bytes.length };
  });
}

/** Escribe los manifiestos presentes en `dest`. Devuelve las rutas escritas. */
export function writeManifests(dest, { latest, meta, files }) {
  ensureDir(dest);
  const written = {};
  if (latest) { writeJson(join(dest, "latest.json"), latest); written.latest = join(dest, "latest.json"); }
  if (meta) { writeJson(join(dest, "meta.json"), meta); written.meta = join(dest, "meta.json"); }
  if (files) { writeJson(join(dest, "files.json"), files); written.files = join(dest, "files.json"); }
  return written;
}

/** Verifica que los recursos de `outDir` coinciden con un manifiesto files.json. */
export function verifyResources(outDir, filesManifest) {
  const byPath = new Map(filesManifest.files.map((f) => [f.path, f]));
  const mismatches = [];
  for (const abs of walk(outDir)) {
    const rel = relative(outDir, abs).split("\\").join("/");
    const entry = byPath.get(rel);
    if (entry && sha256Hex(readBytes(abs)) !== entry.sha256) mismatches.push(rel);
  }
  return { ok: mismatches.length === 0, checked: filesManifest.files.length, mismatches };
}

export const ManifestEngine = {
  platformKey, artifactName, buildLatest, buildMeta, buildFiles,
  filesFromResources, writeManifests, verifyResources,
};
export default ManifestEngine;
