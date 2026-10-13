// I18N · japonés: en los textos de PRODUCTO (sobres, tienda, descripciones) las cifras deben ser las mismas que en
// español. Los numerales que el japonés añade al traducir «una / dos / tres» (1枚, 3枚, 1回…) pasan a kanji (一枚, 三枚).
// Instrumento: node scripts/_i18n-ja-digits.mjs [--apply]
import { readFileSync, writeFileSync } from "node:fs";
const KANJI = { 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 7: "七", 8: "八", 9: "九", 10: "十" };
const strip = (s) => s.replace(/\{[^{}]*\}/g, (m) => " ".repeat(m.length));
const digits = (s) => strip(s).match(/\d+/g) ?? [];
let changed = 0, left = 0;
for (const ns of ["packs", "store", "data"]) {
  const file = `src/i18n/messages/ja/${ns}.json`; const cat = JSON.parse(readFileSync(file, "utf8"));
  for (const [es, ja] of Object.entries(cat)) {
    if (/plural/.test(es)) continue;
    const want = digits(es); const have = digits(ja);
    if ([...want].sort().join() === [...have].sort().join()) continue;
    const remaining = [...want]; const masked = strip(ja); let out = ""; let last = 0;
    for (const m of masked.matchAll(/\d+/g)) {
      out += ja.slice(last, m.index); last = m.index + m[0].length;
      const i = remaining.indexOf(m[0]);
      if (i >= 0) { remaining.splice(i, 1); out += m[0]; }
      else out += KANJI[Number(m[0])] ?? m[0];
    }
    out += ja.slice(last);
    if ([...digits(out)].sort().join() === [...want].sort().join()) { changed++; cat[es] = out; if (process.argv.includes("--show")) console.log(`${ns} :: ${ja.slice(0, 70)}\n      → ${out.slice(0, 70)}`); }
    else { left++; console.log(`SIN RESOLVER ${ns} :: ${es.slice(0, 60)} => ${ja.slice(0, 70)}`); }
  }
  if (process.argv.includes("--apply")) writeFileSync(file, JSON.stringify(cat, null, 2) + "\n");
}
console.log(`${changed} textos con numerales pasados a kanji · ${left} sin resolver${process.argv.includes("--apply") ? " (aplicado)" : ""}`);
