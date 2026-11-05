/**
 * I18N · aplica las traducciones POR MÓDULO de las claves polisémicas (logs/i18n/poly/out-<idioma>.json) a los catálogos.
 * Valida variables y plurales contra el español antes de escribir. npx tsx scripts/_i18n-poly-apply.ts [idioma…]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { messagePlaceholders, messagePluralCategories } from "../src/i18n/icu";

const work = JSON.parse(readFileSync("logs/i18n/poly/work.json", "utf8")) as { ns: string; es: string }[];
const sig = (m: string) => `${[...messagePlaceholders(m)].sort().join(",")}|${JSON.stringify(messagePluralCategories(m))}`;
for (const l of process.argv.slice(2).length ? process.argv.slice(2) : ["fr", "pt-PT", "pt-BR", "ja"]) {
  const file = `logs/i18n/poly/out-${l}.json`;
  if (!existsSync(file)) { console.log(`[${l}] falta ${file}`); continue; }
  const out = JSON.parse(readFileSync(file, "utf8")) as string[];
  if (!Array.isArray(out) || out.length !== work.length) { console.log(`[${l}] RECHAZADO: largo ${out.length} ≠ ${work.length}`); continue; }
  const byNs = new Map<string, Record<string, string>>();
  let changed = 0, rejected = 0;
  work.forEach((w, i) => {
    const v = out[i];
    if (typeof v !== "string" || !v.trim() || sig(v) !== sig(w.es) || /^\s/.test(v) !== /^\s/.test(w.es) || /\s$/.test(v) !== /\s$/.test(w.es)) { rejected++; console.log(`   [${l}] rechazada ${w.ns} «${w.es}» → «${String(v).slice(0, 60)}»`); return; }
    if (!byNs.has(w.ns)) byNs.set(w.ns, JSON.parse(readFileSync(`src/i18n/messages/${l}/${w.ns}.json`, "utf8")));
    const cat = byNs.get(w.ns)!;
    if (cat[w.es] !== v) { changed++; cat[w.es] = v; }
  });
  for (const [ns, cat] of byNs) writeFileSync(`src/i18n/messages/${l}/${ns}.json`, JSON.stringify(cat, null, 2) + "\n", "utf8");
  console.log(`[${l}] ${changed} entradas cambiadas · ${rejected} rechazadas`);
}
