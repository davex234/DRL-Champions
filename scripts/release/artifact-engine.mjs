/**
 * ARTIFACT ENGINE — DESCUBRE automáticamente los artefactos generados. Sin rutas hardcodeadas:
 * escanea los directorios de salida conocidos y clasifica por tipo (installer/firma/manifest).
 */
import { join, basename } from "node:path";
import { walk, exists, fileSize } from "./core/fsx.mjs";

// Raíces donde Tauri/pipeline dejan salidas (se escanean las que existan).
const BUNDLE_ROOTS = [
  "src-tauri/target/release/bundle",
  "src-tauri/target/debug/bundle",
];
const INSTALLER_RE = /\.(exe|msi|appimage|dmg|deb|rpm)$/i;
const MANIFEST_NAMES = new Set(["latest.json", "files.json", "meta.json", "release.json"]);

function classify(path) {
  const name = basename(path).toLowerCase();
  if (name.endsWith(".sig")) return "signature";
  if (MANIFEST_NAMES.has(name)) return "manifest";
  if (INSTALLER_RE.test(name)) return "installer";
  return null;
}

/**
 * Descubre artefactos del proyecto.
 * @returns {{installers:[], signatures:[], manifests:[], bundleDirs:[]}}
 */
export function discover(root) {
  const installers = [], signatures = [], manifests = [], bundleDirs = [];
  const scan = (dir) => {
    if (!exists(dir)) return;
    for (const abs of walk(dir)) {
      const kind = classify(abs);
      if (!kind) continue;
      const entry = { name: basename(abs), path: abs, size: fileSize(abs) };
      if (kind === "installer") installers.push(entry);
      else if (kind === "signature") signatures.push(entry);
      else manifests.push(entry);
    }
  };
  for (const r of BUNDLE_ROOTS) {
    const d = join(root, r);
    if (exists(d)) bundleDirs.push(d);
    scan(d);
  }
  scan(join(root, "dist", "update"));
  return { installers, signatures, manifests, bundleDirs };
}

/** Directorio de bundle preferente (release sobre debug) o null. */
export function primaryBundleDir(root) {
  for (const r of BUNDLE_ROOTS) {
    const d = join(root, r);
    if (exists(d)) return d;
  }
  return null;
}

export const ArtifactEngine = { discover, primaryBundleDir };
export default ArtifactEngine;
