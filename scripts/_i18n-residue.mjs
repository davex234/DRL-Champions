// I18N · restos de español INEQUÍVOCOS en los catálogos (instrumento). node scripts/_i18n-residue.mjs [idioma…]
import { readFileSync, readdirSync } from "node:fs";
const w = (list) => new RegExp(`ñ|¿|¡|ción(?!\\p{L})|ciones(?!\\p{L})|(?<!\\p{L})(${list})(?!\\p{L})`, "iu");
const BASE = "el|los|las|del|hay|muy|pero|también|según|hacia|todavía|aún|jugar|tienda|sobres|mazos?|carril|ahora|aquí|hoy|siguiente|volver|cerrar|puedes|tienes|eres|están|nuevo|nueva|cuenta|equipos?";
const RULES = { "pt-PT": w(BASE + "|con|sin|una|más|y"), "pt-BR": w(BASE + "|con|sin|una|más|y"), fr: w(BASE + "|con|sin|una|más"), ja: w(BASE + "|con|sin|una|más|para|que|cartas?") };
let total = 0;
for (const l of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(RULES)) {
  const hits = [];
  for (const f of readdirSync(`src/i18n/messages/${l}`)) {
    const tr = JSON.parse(readFileSync(`src/i18n/messages/${l}/${f}`, "utf8"));
    for (const [es, v] of Object.entries(tr)) if (RULES[l].test(v.replace(/\{[^{}]*\}/g, " "))) hits.push({ ns: f.replace(".json", ""), es, v });
  }
  total += hits.length;
  console.log(`[${l}] ${hits.length} sospechosos`);
  for (const h of hits.slice(0, Number(process.env.MAX ?? 25))) console.log(`   ${h.ns} :: ${h.es.slice(0, 80)} => ${h.v.slice(0, 110)}`);
  if (process.env.OUT) { const { writeFileSync } = await import("node:fs"); writeFileSync(`${process.env.OUT}/residue-${l}.json`, JSON.stringify(hits, null, 1)); }
}
process.exit(total ? 1 : 0);
