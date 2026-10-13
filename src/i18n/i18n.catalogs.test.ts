/**
 * I18N · CATÁLOGOS — lo que se publica en cada idioma: sin claves ausentes ni vacías, mismas variables que el original,
 * plurales completos, glosario respetado y CIFRAS intactas (un porcentaje o un precio no cambia al traducir).
 *
 * Lee los JSON de `src/i18n/messages/` directamente (la misma fuente que empaquetan los trozos).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LOCALES, LOCALE_INFO } from "./config";
import { formatMessage, messagePlaceholders, messagePluralCategories } from "./icu";

const DIR = join(process.cwd(), "src", "i18n", "messages");
const TARGETS = LOCALES.filter((l) => l !== "es");
const read = (p: string): Record<string, string> => JSON.parse(readFileSync(p, "utf8"));
const namespaces = readdirSync(join(DIR, "es")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
const es = new Map(namespaces.map((n) => [n, read(join(DIR, "es", `${n}.json`))]));
const tr = new Map(TARGETS.map((l) => [l, new Map(namespaces.map((n) => [n, existsSync(join(DIR, l, `${n}.json`)) ? read(join(DIR, l, `${n}.json`)) : {}]))]));
const each = (fn: (locale: string, nsName: string, source: string, value: string | undefined) => void) => {
  for (const l of TARGETS) for (const n of namespaces) for (const k of Object.keys(es.get(n)!)) fn(l, n, k, tr.get(l)!.get(n)![k]);
};
const show = (list: string[]) => `${list.length}: ${list.slice(0, 5).join(" | ")}`;

test("CATÁLOGO · el español es la lista canónica: cada clave es su propio texto y no hay módulos vacíos", () => {
  assert.ok(namespaces.length > 50, "se esperaban los módulos del juego");
  for (const [n, entries] of es) {
    assert.ok(Object.keys(entries).length > 0, `módulo vacío: ${n}`);
    for (const [k, v] of Object.entries(entries)) assert.equal(v, k, `${n}: la clave no coincide con su texto`);
  }
});

test("CATÁLOGO · ninguna clave ausente ni traducción vacía en en/de/it", () => {
  const missing: string[] = [];
  each((l, n, k, v) => { if (typeof v !== "string" || !v.trim()) missing.push(`[${l}] ${n}: ${k.slice(0, 50)}`); });
  assert.equal(missing.length, 0, show(missing));
});

test("CATÁLOGO · ninguna traducción huérfana (de un texto que ya no existe)", () => {
  const orphan: string[] = [];
  for (const l of TARGETS) {
    for (const f of readdirSync(join(DIR, l))) if (f.endsWith(".json") && !es.has(f.slice(0, -5))) orphan.push(`[${l}] módulo ${f}`);
    for (const n of namespaces) for (const k of Object.keys(tr.get(l)!.get(n)!)) if (!(k in es.get(n)!)) orphan.push(`[${l}] ${n}: ${k.slice(0, 50)}`);
  }
  assert.equal(orphan.length, 0, show(orphan));
});

test("CATÁLOGO · las traducciones usan EXACTAMENTE las mismas variables que el original", () => {
  const bad: string[] = [];
  each((l, n, k, v) => { if (v && messagePlaceholders(k).join(",") !== messagePlaceholders(v).join(",")) bad.push(`[${l}] ${n}: «${k.slice(0, 40)}» → «${v.slice(0, 40)}»`); });
  assert.equal(bad.length, 0, show(bad));
});

test("CATÁLOGO · todo plural tiene rama «other» y se puede formatear con 0, 1, 2 y 5 en su idioma", () => {
  const bad: string[] = [];
  each((l, n, k, v) => {
    if (!v || !k.includes(", plural,")) return;
    const cats = messagePluralCategories(v);
    if (!Object.keys(cats).length || Object.values(cats).some((c) => !c.includes("other"))) { bad.push(`[${l}] ${n}: ${k.slice(0, 50)}`); return; }
    const vars = Object.fromEntries(messagePlaceholders(v).map((p) => [p, 0]));
    for (const num of [0, 1, 2, 5]) {
      const out = formatMessage(v, Object.fromEntries(Object.keys(vars).map((p) => [p, num])), LOCALE_INFO[l as "en"].intl);
      if (!out.trim() || /\{|\bplural\b/.test(out)) bad.push(`[${l}] ${n}: «${v.slice(0, 40)}» con ${num} → «${out.slice(0, 40)}»`);
    }
  });
  assert.equal(bad.length, 0, show(bad));
});

test("CATÁLOGO · se conservan los espacios de borde (los textos se concatenan con cifras y otros fragmentos)", () => {
  const bad: string[] = [];
  each((l, n, k, v) => { if (v && (/^\s/.test(k) !== /^\s/.test(v) || /\s$/.test(k) !== /\s$/.test(v))) bad.push(`[${l}] ${n}: «${k.slice(0, 40)}»`); });
  assert.equal(bad.length, 0, show(bad));
});

test("CATÁLOGO · glosario: los términos fijados se traducen siempre igual", () => {
  const glossary: Record<string, Record<string, string>> = JSON.parse(readFileSync(join(process.cwd(), "src", "i18n", "glossary.json"), "utf8"));
  const bad: string[] = [];
  each((l, n, k, v) => { const g = glossary[k]?.[l]; if (v && g && v !== g) bad.push(`[${l}] ${n}: «${k}» = «${v}» (glosario: «${g}»)`); });
  assert.equal(bad.length, 0, show(bad));
});

/** Cifras de un texto, sin separadores de miles ni diferencia entre coma y punto decimal: «17,5 %» ≡ «17.5%». */
const percentages = (s: string) => [...s.matchAll(/(\d+(?:[.,]\d+)?)\s?%/g)].map((m) => m[1].replace(",", ".")).sort().join("|");
const bigNumbers = (s: string) => [...s.matchAll(/\d{1,3}(?:[.,  ]\d{3})+|\d{4,}/g)].map((m) => m[0].replace(/[.,  ]/g, "")).sort().join("|");

test("ECONOMÍA · los PORCENTAJES son idénticos en los cuatro idiomas (probabilidades y condiciones no cambian al traducir)", () => {
  const bad: string[] = [];
  let checked = 0;
  each((l, n, k, v) => {
    if (!v || !/\d\s?%/.test(k)) return;
    checked++;
    if (percentages(k) !== percentages(v)) bad.push(`[${l}] ${n}: «${k.slice(0, 60)}» → «${v.slice(0, 60)}»`);
  });
  assert.ok(checked > 0);
  assert.equal(bad.length, 0, show(bad));
});

test("ECONOMÍA · los PRECIOS y cantidades (miles) son los mismos números en los cuatro idiomas", () => {
  const bad: string[] = [];
  each((l, n, k, v) => { if (v && bigNumbers(k) && bigNumbers(k) !== bigNumbers(v)) bad.push(`[${l}] ${n}: «${k.slice(0, 60)}» → «${v.slice(0, 60)}»`); });
  assert.equal(bad.length, 0, show(bad));
});

test("MARCA · ICON, WALKOUT, DRL Credits y Pick'em no se traducen", () => {
  const bad: string[] = [];
  const brands = ["ICON", "WALKOUT", "DRL Credits", "Pick'em"];
  each((l, n, k, v) => { if (v) for (const b of brands) if (k.includes(b) && !v.includes(b)) bad.push(`[${l}] ${n}: falta «${b}» en «${v.slice(0, 50)}»`); });
  assert.equal(bad.length, 0, show(bad));
});
