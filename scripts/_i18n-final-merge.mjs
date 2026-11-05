/**
 * I18N · cierre (instrumento): fusiona el trabajo de los agentes en los catálogos.
 *
 *   node scripts/_i18n-final-merge.mjs sources     dataSources/extraAdd de logs/i18n/final/tr-*.json → extra-sources.json
 *   node scripts/_i18n-final-merge.mjs merge       traducciones de tr-*.json → messages/{en,de,it} para toda clave que
 *                                                  exista en messages/es y falte; retira huérfanas; lista lo que queda
 *   node scripts/_i18n-final-merge.mjs review      aplica logs/i18n/final/review-*.json (solo si `old` coincide)
 *
 * Tras `sources` hay que ejecutar `npm run i18n:extract` (regenera messages/es) y después `merge`.
 */
import fs from "node:fs";
import path from "node:path";

const DIR = "src/i18n/messages";
const FINAL = "logs/i18n/final";
const LOCALES = ["en", "de", "it"];
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
const writeJson = (f, o, sort = true) => {
  const raw = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  const nl = raw.includes("\r\n") ? "\r\n" : "\n";
  const obj = sort && !Array.isArray(o) ? Object.fromEntries(Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((k) => [k, o[k]])) : o;
  fs.writeFileSync(f, JSON.stringify(obj, null, 2).split("\n").join(nl) + nl, "utf8");
};
const trFiles = fs.readdirSync(FINAL).filter((f) => /^tr-.*\.json$/.test(f)).map((f) => path.join(FINAL, f));
const placeholders = (s) => [...s.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?=[,}])/g)].map((m) => m[1]).sort().join(",");

const mode = process.argv[2];
if (mode === "sources") {
  const f = "src/i18n/extra-sources.json";
  const extra = readJson(f);
  let n = 0;
  for (const t of trFiles) {
    const j = readJson(t);
    for (const s of j.dataSources ?? []) if (!extra.add.data.includes(s)) { extra.add.data.push(s); n++; }
    for (const [mod, list] of Object.entries(j.extraAdd ?? {})) for (const s of list) { (extra.add[mod] ??= []); if (!extra.add[mod].includes(s)) { extra.add[mod].push(s); n++; } }
  }
  writeJson(f, extra, false);
  console.log(`extra-sources: +${n}`);
} else if (mode === "merge") {
  const tr = new Map();
  for (const t of trFiles) for (const [src, v] of Object.entries(readJson(t).translations ?? {})) if (!tr.has(src)) tr.set(src, v);
  const pending = [];
  let added = 0, dropped = 0, badVars = 0;
  for (const file of fs.readdirSync(path.join(DIR, "es"))) {
    const es = readJson(path.join(DIR, "es", file));
    const keys = Array.isArray(es) ? es : Object.keys(es);
    for (const l of LOCALES) {
      const f = path.join(DIR, l, file);
      const cur = fs.existsSync(f) ? readJson(f) : {};
      for (const k of keys) {
        if (cur[k]?.trim()) continue;
        const v = tr.get(k)?.[l];
        if (v && v.trim()) {
          /* las variables y los plurales los valida el auditor (parser ICU real) */
          cur[k] = v; added++;
        } else pending.push({ ns: file.replace(/\.json$/, ""), l, es: k });
      }
      for (const k of Object.keys(cur)) if (!keys.includes(k)) { delete cur[k]; dropped++; }
      writeJson(f, cur);
    }
  }
  for (const l of LOCALES) for (const file of fs.readdirSync(path.join(DIR, l))) if (!fs.existsSync(path.join(DIR, "es", file))) { fs.rmSync(path.join(DIR, l, file)); console.log("módulo retirado", l, file); }
  fs.writeFileSync(path.join(FINAL, "pending.json"), JSON.stringify(pending, null, 1));
  const uniq = new Set(pending.map((p) => p.es));
  console.log(`añadidas ${added} · huérfanas retiradas ${dropped} · variables incompatibles ${badVars} · pendientes ${pending.length} (${uniq.size} textos) → ${FINAL}/pending.json`);
} else if (mode === "review") {
  let ok = 0, stale = 0, bad = 0; const rejected = [];
  for (const f of fs.readdirSync(FINAL).filter((x) => /^review-(en|de|it)-.*\.json$/.test(x))) {
    const l = f.split("-")[1];
    const byNs = {};
    for (const c of readJson(path.join(FINAL, f)).corrections ?? []) (byNs[c.ns] ??= []).push(c);
    for (const [mod, list] of Object.entries(byNs)) {
      const file = path.join(DIR, l, `${mod}.json`);
      if (!fs.existsSync(file)) { stale += list.length; continue; }
      const cur = readJson(file);
      for (const c of list) {
        if (!(c.es in cur) || cur[c.es] !== c.old) { stale++; rejected.push({ f, ...c, why2: "old no coincide" }); continue; }
        const lead = (s) => s.match(/^\s*/)[0], trail = (s) => s.match(/\s*$/)[0];
        if (!c.new?.trim() || placeholders(c.new) !== placeholders(c.es) || lead(c.new) !== lead(c.es) || trail(c.new) !== trail(c.es)) { bad++; rejected.push({ f, ...c, why2: "variables/espacios" }); continue; }
        cur[c.es] = c.new; ok++;
      }
      writeJson(file, cur);
    }
  }
  fs.writeFileSync(path.join(FINAL, "review-rejected.json"), JSON.stringify(rejected, null, 1));
  console.log(`correcciones aplicadas ${ok} · desfasadas ${stale} · rechazadas por variables/espacios ${bad}`);
} else throw new Error("sources|merge|review");
