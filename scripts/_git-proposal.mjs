// GIT · clasifica el árbol pendiente para proponer commits (instrumento; NO ejecuta ningún comando que escriba en git).
//   node scripts/_git-proposal.mjs <base.sha de producción> <dir con src de antes de i18n (opcional)> <salida.json>
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [baseFile, preI18nDir, outFile] = process.argv.slice(2);
const base = new Map(readFileSync(baseFile, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(66).replace(/^\.\//, ""), l.slice(0, 64)]));
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const pending = execSync("git status --porcelain=v1 -uall", { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean)
  .map((l) => ({ st: l.slice(0, 2).trim(), f: l.slice(3).replace(/^"|"$/g, "") }));

const is = {
  secretish: (f) => /(^|\/)\.env(\.|$)(?!example)|secrets?\/|\.pem$|\.key$|\.dump$/.test(f) && f !== ".env.example",
  logs: (f) => f.startsWith("logs/"),
  local: (f) => f.startsWith(".claude/") || f === "puente.png" || f.startsWith("mapas/"),
  f78: (f) => /^scripts\/ops\/(backup-|offsite-|b2-provision|restore-|_f78-)/.test(f) || f === "src/instrumentation.ts" || /^src\/domain\/ops\/backup(\.test)?\.ts$/.test(f),
  i18n: (f) => /^src\/i18n\//.test(f) || /^scripts\/i18n\//.test(f) || /^docs\/i18n\//.test(f) || /^public\/walkout\/flags\/pt\.svg$/.test(f) || /^public\/flags\/(gb|de|it|fr|br|jp)\.svg$/.test(f),
  qa: (f) => /^scripts\/_i18n-|^scripts\/_icon-odds\/|^scripts\/_onboarding\/|^scripts\/ops\/(i18n-qa-stack\/|_i18n-rc-)|^scripts\/_git-proposal\.mjs$|^scripts\/lib\/cdp\.ts$/.test(f),
  docsRelease: (f) => /^docs\/product\/(i18n-|icon-odds)/.test(f),
  icon: (f) => /icon|Icon|ICON/.test(f) && /^src\//.test(f) || /^src\/domain\/packs\/(iconQuality|priceConfirm|packClass|odds|openPack|packEconomy)/.test(f) || /^src\/data\/(packs|packStats|packArtwork|storeCatalog)\.ts$/.test(f),
};
const buckets = {};
const put = (b, f) => (buckets[b] ??= []).push(f);
for (const { f } of pending) {
  if (!existsSync(f) || !statSync(f).isFile()) { put("borrados-o-raros", f); continue; }
  if (is.secretish(f)) { put("EXCLUIR · posible secreto", f); continue; }
  if (is.logs(f)) { put("EXCLUIR · logs/", f); continue; }
  if (is.local(f)) { put("EXCLUIR · local del PC", f); continue; }
  if (is.f78(f)) { put("APARTE · F78 off-site (no desplegado)", f); continue; }
  if (is.qa(f)) { put("4 · QA e instrumentos", f); continue; }
  if (is.docsRelease(f)) { put("4 · QA e instrumentos", f); continue; }
  const h = sha(f);
  if (base.get(f) === h) { put("0 · base = producción e5db60b6", f); continue; }
  if (is.i18n(f)) { put("2 · i18n (infraestructura y catálogos)", f); continue; }
  const inBase = base.has(f);
  let pre = null;
  if (preI18nDir && existsSync(join(preI18nDir, f))) pre = sha(join(preI18nDir, f));
  if (f.startsWith("src/") || f.startsWith("public/") || /^(package|package-lock)\.json$|^next\.config|^tailwind\.config|^tsconfig|^\.eslintrc|^eslint\.config/.test(f)) {
    if (pre && pre === h) put(inBase ? "1 · ICON y cambios previos a i18n (modifican producción)" : "1 · ICON y cambios previos a i18n (nuevos)", f);
    else if (pre && inBase && pre !== base.get(f)) put("1+2 · tocado por ICON/previo Y por i18n", f);
    else put("2 · i18n (texto envuelto en código de la app)", f);
    continue;
  }
  put(f.startsWith("docs/") ? "0b · docs fuera de la release (histórico)" : f.startsWith("scripts/") ? "0b · scripts fuera de la release (histórico)" : f.startsWith("supabase/") ? "0b · supabase (migraciones ya aplicadas)" : "otros", f);
}
const summary = Object.fromEntries(Object.entries(buckets).sort().map(([k, v]) => [k, v.length]));
console.log(JSON.stringify(summary, null, 1));
writeFileSync(outFile, JSON.stringify(buckets, null, 1));
