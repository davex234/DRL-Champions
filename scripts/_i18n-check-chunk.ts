/**
 * I18N · COMPRUEBA UN TROZO TRADUCIDO antes de fusionarlo (instrumento del reparto de traducción).
 *
 *   npx tsx scripts/_i18n-check-chunk.ts <idioma> <NNN> [NNN…]
 *
 * Mismo largo que el trabajo, todo cadenas no vacías, mismas variables y mismas categorías de plural que el español,
 * espacios iniciales/finales conservados y, en japonés, que el texto no se haya quedado en español.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { messagePlaceholders, messagePluralCategories } from "../src/i18n/icu";

const [locale, ...ids] = process.argv.slice(2);
if (!locale || ids.length === 0) { console.log("uso: _check-chunk.ts <idioma> <NNN> [NNN…]"); process.exit(2); }
const sorted = (xs: Iterable<string>) => [...xs].sort().join(",");
let failed = 0;
for (const id of ids) {
  const workFile = join("logs/i18n/work", locale, `${id}.json`), outFile = join("logs/i18n/out", locale, `${id}.json`);
  if (!existsSync(outFile)) { console.log(`${id}: FALTA ${outFile}`); failed++; continue; }
  const work = JSON.parse(readFileSync(workFile, "utf8")) as { ns: string; es: string }[];
  let out: unknown;
  try { out = JSON.parse(readFileSync(outFile, "utf8")); } catch (e) { console.log(`${id}: JSON inválido — ${String(e).slice(0, 120)}`); failed++; continue; }
  if (!Array.isArray(out)) { console.log(`${id}: la salida no es un array`); failed++; continue; }
  const problems: string[] = [];
  if (out.length !== work.length) problems.push(`largo ${out.length} ≠ ${work.length}`);
  work.forEach((w, i) => {
    const v = out[i];
    if (typeof v !== "string" || !v.trim()) { if (i < out.length) problems.push(`[${i}] vacío o no es texto`); return; }
    try {
      if (sorted(messagePlaceholders(w.es)) !== sorted(messagePlaceholders(v))) problems.push(`[${i}] variables «${sorted(messagePlaceholders(w.es))}» ≠ «${sorted(messagePlaceholders(v))}» · ${w.es.slice(0, 60)}`);
      const pe = JSON.stringify(messagePluralCategories(w.es)), pv = JSON.stringify(messagePluralCategories(v));
      if (pe !== pv) problems.push(`[${i}] plural ${pe} ≠ ${pv} · ${w.es.slice(0, 60)}`);
    } catch (e) { problems.push(`[${i}] sintaxis ICU: ${String(e).slice(0, 80)}`); }
    if (/^\s/.test(w.es) !== /^\s/.test(v) || /\s$/.test(w.es) !== /\s$/.test(v)) problems.push(`[${i}] espacio inicial/final distinto · «${w.es.slice(0, 40)}»`);
  });
  if (problems.length) { failed++; console.log(`${id}: ${problems.length} problema(s)`); for (const p of problems.slice(0, 25)) console.log(`   ${p}`); }
  else console.log(`${id}: OK (${work.length})`);
}
process.exit(failed ? 1 : 0);
