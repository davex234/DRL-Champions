// I18N · cierre final: paquete de REVISIÓN de los textos de ICON, tienda, compras y crafteo por idioma.
// node scripts/_i18n-review-bundle.mjs  →  logs/i18n/final/review-<idioma>.json  ([{ ns, es, en?, tr }])
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
const D = "src/i18n/messages";
const FULL = new Set(["craft", "crafting", "credits", "economy", "forge", "pack", "packs", "store", "tienda", "walkout"]);
const TOPIC = /\bsobres?\b|icon|cr[eé]ditos?|compra|comprar|forja|forjar|receta|craft|garantizad|probabilidad|precio|saldo|desguac|duplicad/i;
const load = (l, ns) => JSON.parse(readFileSync(`${D}/${l}/${ns}.json`, "utf8"));
mkdirSync("logs/i18n/final", { recursive: true });
const mods = readdirSync(`${D}/es`).map((f) => f.replace(/\.json$/, "")).filter((ns) => ns !== "admin");
for (const l of ["en", "de", "it", "fr", "pt-PT", "pt-BR", "ja"]) {
  const out = [];
  for (const ns of mods) {
    const es = load("es", ns), tr = load(l, ns), en = l === "en" ? null : load("en", ns);
    for (const k of Object.keys(es)) if (FULL.has(ns) || TOPIC.test(k)) out.push(en ? { ns, es: k, en: en[k], tr: tr[k] } : { ns, es: k, tr: tr[k] });
  }
  writeFileSync(`logs/i18n/final/review-${l}.json`, JSON.stringify(out, null, 1));
  console.log(l, out.length);
}
