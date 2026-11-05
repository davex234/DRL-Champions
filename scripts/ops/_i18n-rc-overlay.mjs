/**
 * RC i18n+ICON (2026-10-11) · calcula el OVERLAY respecto a la fuente de producción (instrumento; no despliega nada).
 *
 *   node scripts/ops/_i18n-rc-overlay.mjs <prod-base.sha> <carpeta de salida>
 *
 * `prod-base.sha` = `sha256sum` de la fuente de la release viva (sin node_modules/.next). Conjunto local = lo que
 * versiona git + lo no ignorado, menos documentación, entornos, capturas y lo que se queda FUERA a propósito (F78
 * off-site y arreglos solo locales). Escribe overlay.txt (añadidos + modificados), removed.txt (en producción y no en
 * local: solo informativo, NO se borra nada), excluded.txt y manifest.json (ruta → sha256). Sin red.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const [baseFile, outDir] = process.argv.slice(2);
if (!baseFile || !outDir) throw new Error("uso: _i18n-rc-overlay.mjs <prod-base.sha> <salida>");
mkdirSync(outDir, { recursive: true });
const base = new Map(readFileSync(baseFile, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(66).replace(/^\.\//, ""), l.slice(0, 64)]));
/** Fuera de la release: no forman parte de la app o se decidieron dejar fuera en releases anteriores. */
const OUT_OF_RELEASE = [/^docs\//, /^\.env/, /^logs\//, /^\.claude\//, /^\.next\//, /^node_modules\//, /^deploy\//, /^out\//, /^src-tauri\/target\//, /\.tsbuildinfo$/, /^next-env\.d\.ts$/, /^Cartas\//, /^personajes\//, /^captures?\//, /^qa\//, /^tmp\//];
/** F78 (off-site) y arreglos solo locales: se quedan como estén en producción. */
const KEEP_PROD = [/^scripts\/ops\/(backup-|offsite-|b2-provision|restore-|_f78-)/, /^src\/instrumentation\.ts$/, /^src\/domain\/ops\/backup(\.test)?\.ts$/, /^docs\/operations\//, /^scripts\/ops\/vps\/supabase-drlcards\//];
/** Lo que entra en el overlay: la app, sus estáticos, su configuración y las herramientas que usan sus scripts npm. */
const IN_RELEASE = [/^src\//, /^public\//, /^(package\.json|package-lock\.json|next\.config\.mjs|tailwind\.config\.[a-z]+|tsconfig[^/]*\.json|postcss\.config\.[a-z]+|\.eslintrc\.json)$/, /^scripts\/i18n\//, /^scripts\/economy41-verify\.ts$/];
const files = execSync("git ls-files -co --exclude-standard", { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean);
const added = [], modified = [], same = [], excluded = [], manifest = {};
for (const f of files) {
  if (OUT_OF_RELEASE.some((r) => r.test(f))) continue;
  if (!existsSync(f) || !statSync(f).isFile()) continue;
  if (KEEP_PROD.some((r) => r.test(f))) { excluded.push(f); continue; }
  if (!IN_RELEASE.some((r) => r.test(f))) continue;
  const h = createHash("sha256").update(readFileSync(f)).digest("hex");
  if (!base.has(f)) { added.push(f); manifest[f] = h; }
  else if (base.get(f) !== h) { modified.push(f); manifest[f] = h; }
  else same.push(f);
}
const local = new Set(files);
const removed = [...base.keys()].filter((f) => !local.has(f)).sort();
writeFileSync(join(outDir, "overlay.txt"), [...added, ...modified].sort().join("\n") + "\n");
writeFileSync(join(outDir, "added.txt"), added.sort().join("\n") + "\n");
writeFileSync(join(outDir, "modified.txt"), modified.sort().join("\n") + "\n");
writeFileSync(join(outDir, "removed-informative.txt"), removed.join("\n") + "\n");
writeFileSync(join(outDir, "excluded.txt"), excluded.sort().join("\n") + "\n");
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 1));
const top = (list) => Object.entries(list.reduce((a, f) => { const k = f.split("/").slice(0, 2).join("/"); a[k] = (a[k] ?? 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, n]) => `${k}:${n}`).join("  ");
console.log(`base ${base.size} · iguales ${same.length} · añadidos ${added.length} · modificados ${modified.length} · solo en producción ${removed.length} · excluidos ${excluded.length}`);
console.log("añadidos   ", top(added));
console.log("modificados", top(modified));
