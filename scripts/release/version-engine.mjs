/**
 * VERSION ENGINE — autoridad ÚNICA de versiones de DRL Champions.
 *
 * Nadie modifica versiones directamente: todo pasa por aquí. Gestiona:
 *   version · build · canal · changelog · fecha · commit · hash (fingerprint)
 *
 * `version.json` (raíz) es el origen canónico. Sincroniza a package.json / tauri.conf.json /
 * Cargo.toml / src/platform/version.ts. Detecta cambios por fingerprint SHA256 (normalizando
 * los campos de versión para no auto-dispararse) y genera notas/changelog automáticos.
 *
 * (Absorbe la lógica de los antiguos lib/version-manager.mjs y lib/changes.mjs, sin duplicar.)
 */
import { join, extname } from "node:path";
import { readJson, writeJson, readText, writeText, exists, walk } from "./core/fsx.mjs";
import { sha256Hex } from "./core/hash.mjs";
import { capture } from "./core/proc.mjs";

export const VERSION_FILE = "version.json";

// ─────────────────────────── versión semver + build ───────────────────────────
export function readVersion(root) {
  const p = join(root, VERSION_FILE);
  if (!exists(p)) return { version: "0.0.0", build: 0, channel: "stable" };
  const j = readJson(p);
  return { version: j.version ?? "0.0.0", build: Number(j.build ?? 0), channel: j.channel ?? "stable" };
}
export function writeVersion(root, v) {
  writeJson(join(root, VERSION_FILE), { version: v.version, build: v.build, channel: v.channel });
}
export function bumpSemver(version, level = "patch") {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) throw new Error(`Versión no semver: ${version}`);
  let [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (level === "major") { maj += 1; min = 0; pat = 0; }
  else if (level === "minor") { min += 1; pat = 0; }
  else if (level === "patch") { pat += 1; }
  else if (level === "none") { /* solo build */ }
  else throw new Error(`Nivel desconocido: ${level}`);
  return `${maj}.${min}.${pat}`;
}
export const fullVersion = (v) => `${v.version}+${v.build}`;

/** Versión siguiente: build +1 SIEMPRE; semver según el nivel. */
export function nextVersion(root, level = "patch", channel) {
  const prev = readVersion(root);
  return { version: bumpSemver(prev.version, level), build: prev.build + 1, channel: channel ?? prev.channel };
}

// ─────────────────────────── sincronización en el proyecto ───────────────────────────
function patchJson(root, file, mutate) {
  const p = join(root, file);
  const j = readJson(p);
  mutate(j);
  writeJson(p, j);
}

/** Sincroniza la versión a TODOS los puntos del proyecto. Idempotente. */
export function syncProject(root, v) {
  patchJson(root, "package.json", (j) => (j.version = v.version));
  patchJson(root, "src-tauri/tauri.conf.json", (j) => (j.version = v.version));

  const cargoPath = join(root, "src-tauri", "Cargo.toml");
  writeText(cargoPath, readText(cargoPath).replace(/^version = ".*"$/m, `version = "${v.version}"`));

  const verPath = join(root, "src", "platform", "version.ts");
  writeText(
    verPath,
    readText(verPath)
      .replace(/APP_VERSION = ".*"/, `APP_VERSION = "${v.version}"`)
      .replace(/BUILD_NUMBER = \d+/, `BUILD_NUMBER = ${v.build}`)
      .replace(/BUILD_CHANNEL = ".*"/, `BUILD_CHANNEL = "${v.channel}"`),
  );
  return v;
}

// ─────────────────────────── fingerprint / cambios ───────────────────────────
const INCLUDE_DIRS = ["src", "src-tauri/src", "src-tauri/capabilities", "public", "scripts"];
const INCLUDE_FILES = [
  "package.json", "package-lock.json", "next.config.mjs", "tailwind.config.ts", "tailwind.config.js",
  "postcss.config.mjs", "postcss.config.js", "tsconfig.json", "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json", "src-tauri/build.rs",
];
const EXCLUDE_RE = /(^|\/)(node_modules|\.next|out|dist|\.git|\.release)\//;
const EXCLUDE_EXACT = new Set(["version.json", "src/platform/version.ts"]);

/** Normaliza la versión de un fichero para que un mero bump no se detecte como cambio. */
function readNormalized(root, rel) {
  const abs = join(root, rel);
  const raw = readText(abs);
  if (rel === "package.json" || rel === "src-tauri/tauri.conf.json") {
    try { const j = JSON.parse(raw); delete j.version; return JSON.stringify(j); } catch { return raw; }
  }
  if (rel === "src-tauri/Cargo.toml") return raw.replace(/^version = ".*"$/m, 'version = "0.0.0"');
  return raw;
}

/** Fingerprint determinista del proyecto: { files: {rel: sha}, hash }. */
export function fingerprint(root) {
  const rels = [];
  for (const d of INCLUDE_DIRS) {
    for (const abs of walk(join(root, d))) {
      const rel = abs.slice(root.length + 1).split("\\").join("/");
      if (!EXCLUDE_RE.test(`/${rel}/`)) rels.push(rel);
    }
  }
  for (const f of INCLUDE_FILES) if (exists(join(root, f))) rels.push(f);

  const files = {};
  for (const rel of rels) if (!EXCLUDE_EXACT.has(rel)) files[rel] = sha256Hex(readNormalized(root, rel));

  const g = [];
  for (const k of Object.keys(files).sort()) g.push(`${k}:${files[k]}`);
  return { files, hash: sha256Hex(g.join("\n")) };
}

export function diff(prevFiles = {}, curFiles = {}) {
  const changed = [], added = [], removed = [];
  for (const k of Object.keys(curFiles)) {
    if (!(k in prevFiles)) added.push(k);
    else if (prevFiles[k] !== curFiles[k]) changed.push(k);
  }
  for (const k of Object.keys(prevFiles)) if (!(k in curFiles)) removed.push(k);
  return { changed, added, removed };
}

/** Estado de cambios respecto a la última release de un canal. */
export function detectChanges(root, channel) {
  const cur = fingerprint(root);
  const lastPath = join(root, ".release", `last.${channel}.json`);
  const last = exists(lastPath) ? readJson(lastPath) : null;
  return { cur, last, hasChanges: !last || last.hash !== cur.hash, delta: diff(last?.files ?? {}, cur.files) };
}

// ─────────────────────────── notas / changelog ───────────────────────────
const MODULE_MAP = [
  [/^src\/brain\//, "Brain Engine"],
  [/^src\/utility\//, "Utility Engine"],
  [/^src\/agents\//, "Agent Engine"],
  [/^src\/tactics\//, "Tactical Engine"],
  [/^src\/spatial\//, "Spatial Engine"],
  [/^src\/narrative\//, "Narrative Engine"],
  [/^src\/(sim|combat2)\//, "Match Engine"],
  [/^src\/lib\/match\//, "Match Engine"],
  [/^src\/coach\/|^src\/components\/coach\//, "Coach"],
  [/^src\/economy\/|^src\/domain\/economy\//, "Economy Engine"],
  [/^src\/(intel|live)\/|^src\/(domain|data)\/esports\//, "Live Esports"],
  [/^src\/components\/cards\/|^src\/domain\/cards\//, "Card system"],
  [/^src\/components\/launcher\/|^src\/platform\/|^scripts\//, "Launcher & Updater"],
  [/^src\/components\/broadcast\//, "Broadcast"],
  [/^src\/branding\//, "Branding"],
  [/^src-tauri\//, "Desktop runtime"],
  [/^src\/store\//, "Game state"],
  [/^src\/app\//, "UI / Pages"],
  [/^src\/components\//, "UI components"],
  [/^public\//, "Assets"],
  [/package(-lock)?\.json$|config|tsconfig/, "Dependencies & Config"],
];
function moduleOf(path) {
  for (const [re, label] of MODULE_MAP) if (re.test(path)) return label;
  return extname(path) === ".css" ? "Styles" : "Otros";
}

export function releaseNotes({ changed = [], added = [], removed = [] } = {}) {
  const all = [...changed, ...added, ...removed];
  const counts = {};
  for (const p of all) counts[moduleOf(p)] = (counts[moduleOf(p)] ?? 0) + 1;
  const priority = MODULE_MAP.map(([, l]) => l).concat(["Styles", "Otros"]);
  const modules = Object.keys(counts).sort((a, b) => priority.indexOf(a) - priority.indexOf(b));
  const bullets = modules.length
    ? modules.map((m) => `${m} (${counts[m]} ${counts[m] === 1 ? "archivo" : "archivos"})`)
    : ["Mejoras internas y correcciones"];
  return { bullets, modules, counts, totalFiles: all.length };
}

export function changelogText({ version, channel, date, bullets, totalFiles }) {
  return `DRL Champions v${version} (${channel})\n\nCambios:\n${bullets.map((b) => `• ${b}`).join("\n")}\n\n${totalFiles} archivos · ${String(date).slice(0, 10)}`;
}

// ─────────────────────────── commit (git, best-effort) ───────────────────────────
export function gitCommit(root) {
  const r = capture("git rev-parse --short HEAD", { cwd: root });
  return r.ok ? r.out : null;
}

// ─────────────────────────── escritura de la release (único escritor) ───────────────────────────
/** Aplica la versión nueva al proyecto (version.json + ficheros sincronizados). */
export function applyVersion(root, v) {
  writeVersion(root, v);
  syncProject(root, v);
  return v;
}

/** Registra la release: changelog + huella de la última release del canal. */
export function recordRelease(root, { version, build, channel, date, hash, files, notes }) {
  const changelog = join(root, "CHANGELOG.md");
  const prev = exists(changelog) ? readText(changelog).replace(/^# Changelog\n+/, "") : "";
  writeText(changelog, `# Changelog\n\n## ${version}+${build} — ${String(date).slice(0, 10)}\n\n${notes}\n\n${prev}`);
  writeJson(join(root, ".release", `last.${channel}.json`), { version, build, channel, hash, files, releasedAt: date, notes });
}

export const VersionEngine = {
  readVersion, writeVersion, nextVersion, bumpSemver, fullVersion,
  syncProject, fingerprint, diff, detectChanges,
  releaseNotes, changelogText, gitCommit, applyVersion, recordRelease,
};
export default VersionEngine;
