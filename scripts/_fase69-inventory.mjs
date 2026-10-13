/**
 * FASE 69 · INVENTARIO DE RELEASE (solo lectura; fuera de CI). Simula «¿qué entraría si mañana hacemos commit?».
 *   node scripts/_fase69-inventory.mjs
 * Escribe en docs/product/qa/fase69-hardening/: release-file-inventory.json, secret-precommit.json, gitignore-audit.json.
 * Nunca imprime ni guarda VALORES de secretos: solo el nombre de la variable y el fichero donde aparecería.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = "docs/product/qa/fase69-hardening";
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

// ── 1. estado del árbol ──────────────────────────────────────────────────────
const porcelain = git("status", "--porcelain=v1", "-z", "--untracked-files=all").split("\0").filter(Boolean);
const entries = [];
for (let i = 0; i < porcelain.length; i++) {
  const rec = porcelain[i]; const code = rec.slice(0, 2); let path = rec.slice(3);
  if (code[0] === "R" || code[0] === "C") i++; // el origen del rename va en el siguiente registro
  entries.push({ code, path });
}
const size = (p) => { try { return statSync(p).size; } catch { return 0; } };

function classify(e) {
  const p = e.path.replace(/\\/g, "/");
  if (/^\.env(\.|$)/.test(p) && !/\.example$/.test(p)) return "secret/excluded";
  if (/(^|\/)(\.next|node_modules|out|dist|coverage)\//.test(p)) return "generated disposable";
  if (/\.(log|tmp|bak\d*|orig|dump)$/i.test(p) || /(^|\/)(tmp|temp)\//.test(p)) return "generated disposable";
  if (/^docs\/product\/qa\//.test(p) || /^docs\/product\/.*\.(png|jpe?g|webm|gif)$/i.test(p)) return "QA evidence";
  if (/^scripts\/_fase\d/.test(p) || /^scripts\/_/.test(p)) return "QA instrument (untracked tooling)";
  if (/^deploy\//.test(p)) return "runtime-only";
  if (/^\.claude\//.test(p)) return "runtime-only";
  if (/^public\//.test(p)) return /\.(png|jpe?g|webp|avif|svg|mp4|webm|mp3|ogg|woff2?)$/i.test(p) ? "generated required (asset)" : "required source";
  // Arte ORIGINAL aportado por el usuario (entrada de los importadores; lo servido vive derivado en public/). 700+ MB:
  // no es código ni build → archivo externo o Git LFS, a decidir en F70.
  if (/^(cartas|sobres|mapas)\//i.test(p) || /^[^/]+\.(png|jpe?g)$/i.test(p)) return "source art (external archive / LFS)";
  if (/^(src|supabase|scripts|docs|personajes)\//i.test(p) || /^[^/]+\.(json|mjs|js|ts|md|toml|yml|yaml)$/.test(p) || /^\.(gitignore|eslintrc\.json|env\.example|nvmrc)$/.test(p)) return "required source";
  return "unclassified (review)";
}
const bucket = {};
const tracked = { modified: 0, deleted: 0, added: 0, renamed: 0 };
for (const e of entries) {
  const c = e.code;
  if (c === "??") e.class = classify(e);
  else {
    e.class = "tracked " + (c.includes("D") ? "deleted" : c.includes("A") ? "added" : c.includes("R") ? "renamed" : "modified");
    tracked[c.includes("D") ? "deleted" : c.includes("A") ? "added" : c.includes("R") ? "renamed" : "modified"]++;
  }
  e.bytes = c.includes("D") ? 0 : size(e.path);
  (bucket[e.class] ??= { files: 0, bytes: 0, sample: [] });
  bucket[e.class].files++; bucket[e.class].bytes += e.bytes;
  if (bucket[e.class].sample.length < 12) bucket[e.class].sample.push(e.path);
}
const byTop = {};
for (const e of entries) { const top = e.path.split("/").slice(0, e.path.startsWith("src/") ? 2 : 1).join("/"); (byTop[top] ??= { tracked: 0, untracked: 0 }); e.code === "??" ? byTop[top].untracked++ : byTop[top].tracked++; }

// ── 2. ficheros grandes (candidatos a entrar) ────────────────────────────────
const candidates = entries.filter((e) => !["secret/excluded", "generated disposable"].includes(e.class) && !e.code.includes("D"));
const large = candidates.filter((e) => e.bytes > 5 * 1024 * 1024).map((e) => ({ path: e.path, mb: +(e.bytes / 1048576).toFixed(1), class: e.class }))
  .sort((a, b) => b.mb - a.mb);
const largest = candidates.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 20).map((e) => ({ path: e.path, mb: +(e.bytes / 1048576).toFixed(2), class: e.class }));
const qaSplit = {};
for (const e of candidates.filter((x) => x.class === "QA evidence")) { const ext = (e.path.match(/\.([a-z0-9]+)$/i)?.[1] ?? "other").toLowerCase(); (qaSplit[ext] ??= { files: 0, mb: 0 }); qaSplit[ext].files++; qaSplit[ext].mb = +(qaSplit[ext].mb + e.bytes / 1048576).toFixed(1); }
const trackedLarge = git("ls-files", "-z").split("\0").filter(Boolean).map((p) => ({ path: p, mb: +(size(p) / 1048576).toFixed(1) })).filter((x) => x.mb > 5).sort((a, b) => b.mb - a.mb);

// ── 3. .gitignore: lo que debería ignorarse y no lo está ─────────────────────
const shouldIgnore = candidates.filter((e) => /\.(log|dump|sqlite|db|pem|key|p12|pfx)$/i.test(e.path) || /(^|\/)\.env(\.|$)/.test(e.path) && !/\.example$/.test(e.path) || /\.bak\d*$/i.test(e.path) || /(^|\/)(screenshots?-tmp|tmp)\//i.test(e.path)).map((e) => e.path);
const ignoredCheck = [".env.local", ".next/BUILD_ID", "deploy/drlcards-sync", "node_modules/.package-lock.json"].map((p) => {
  let ignored = false; try { git("check-ignore", "-q", p); ignored = true; } catch { ignored = false; }
  return { path: p, exists: existsSync(p), ignored };
});

// ── 4. escaneo de secretos (sin valores) ─────────────────────────────────────
const env = existsSync(".env.local") ? Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])) : {};
const SECRET_KEYS = Object.keys(env).filter((k) => !/^NEXT_PUBLIC_/.test(k) && (env[k] ?? "").length >= 12);
const PUBLIC_KEYS = Object.keys(env).filter((k) => /^NEXT_PUBLIC_.*(KEY|ANON)/.test(k) && (env[k] ?? "").length >= 12);
const PATTERNS = [
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["anthropic key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["openai-like key", /\bsk-[A-Za-z0-9]{32,}\b/],
  ["aws access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["github token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["jwt (service_role)", /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*cm9sZSI6InNlcnZpY2Vfcm9sZS[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{10,}/],
  ["password assignment", /\b(password|passwd|contraseña)\s*[:=]\s*["'][^"'\s]{8,}["']/i],
];
const textual = (p) => /\.(ts|tsx|js|mjs|cjs|json|md|sql|sh|ps1|toml|ya?ml|env|txt|html|css|py)$/i.test(p) || /^\.env/.test(p.split("/").pop());
const hits = [];
let scanned = 0;
for (const e of candidates) {
  if (!textual(e.path) || e.bytes > 8 * 1024 * 1024) continue;
  let s; try { s = readFileSync(e.path, "utf8"); } catch { continue; }
  scanned++;
  for (const k of SECRET_KEYS) if (s.includes(env[k])) hits.push({ file: e.path, kind: `valor literal de ${k} (.env.local)`, severity: "BLOCKER" });
  for (const k of PUBLIC_KEYS) if (s.includes(env[k])) hits.push({ file: e.path, kind: `valor literal de ${k} (clave pública anon: no secreta, pero no debería ir en evidencia)`, severity: "INFO" });
  for (const [kind, re] of PATTERNS) if (re.test(s)) hits.push({ file: e.path, kind, severity: kind === "password assignment" ? "REVIEW" : "BLOCKER" });
}
// también los ficheros YA versionados (un secreto commiteado antes seguiría en el historial)
let trackedHits = 0;
for (const p of git("ls-files", "-z").split("\0").filter(Boolean)) {
  if (!textual(p) || size(p) > 8 * 1024 * 1024) continue;
  let s; try { s = readFileSync(p, "utf8"); } catch { continue; }
  for (const k of SECRET_KEYS) if (s.includes(env[k])) { trackedHits++; hits.push({ file: p, kind: `valor literal de ${k} en fichero VERSIONADO`, severity: "BLOCKER" }); }
}

const inventory = {
  at: new Date().toISOString(), head: git("rev-parse", "--short", "HEAD").trim(), branch: git("rev-parse", "--abbrev-ref", "HEAD").trim(),
  totals: { entries: entries.length, trackedChanges: tracked, untracked: entries.filter((e) => e.code === "??").length },
  classes: bucket, byTopLevel: byTop, large, largest, qaEvidenceByType: qaSplit, trackedLarge,
  unclassified: entries.filter((e) => e.class === "unclassified (review)").map((e) => e.path),
};
writeFileSync(join(OUT, "release-file-inventory.json"), JSON.stringify(inventory, null, 2));
writeFileSync(join(OUT, "gitignore-audit.json"), JSON.stringify({ at: inventory.at, shouldBeIgnoredButAreCandidates: shouldIgnore, ignoredCheck }, null, 2));
writeFileSync(join(OUT, "secret-precommit.json"), JSON.stringify({
  at: inventory.at, scannedCandidateFiles: scanned, secretKeysChecked: SECRET_KEYS, publicKeysChecked: PUBLIC_KEYS,
  patterns: PATTERNS.map(([k]) => k), hits, trackedHits,
  verdict: hits.some((h) => h.severity === "BLOCKER") ? "BLOCKER" : hits.length ? "REVIEW" : "CLEAN",
}, null, 2));
console.log(JSON.stringify({ totals: inventory.totals, classes: Object.fromEntries(Object.entries(bucket).map(([k, v]) => [k, `${v.files} files / ${(v.bytes / 1048576).toFixed(1)} MB`])), large: large.length, trackedLarge: trackedLarge.length, unclassified: inventory.unclassified.length, shouldIgnore: shouldIgnore.length, ignoredCheck, secretHits: hits.map((h) => `${h.severity} ${h.file} :: ${h.kind}`) }, null, 2));
