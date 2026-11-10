/**
 * I18N · EL IDIOMA NO TOCA LA ECONOMÍA.
 *
 * Con los catálogos REALES de cada idioma cargados, se calcula la misma foto económica (precios, cartas por sobre,
 * tablas de probabilidad, Icon por sobre, y el sorteo determinista de aperturas) y se compara con la española. Solo
 * pueden cambiar los TEXTOS: cualquier número o identificador distinto es un fallo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PACKS, getPack } from "@/data/packs";
import { classOddsFor, iconOddsFor } from "@/domain/packs/odds";
import { ICON_CHANCE_BP } from "@/domain/packs/packClass";
import { openPack } from "@/domain/packs/openPack";
import { freshPity } from "@/domain/packs/pity";
import { CardRegistry } from "@/collection/registry";
import { formatDRLC } from "@/domain/economy/drlCredits";
import { LOCALES, type Locale } from "./config";
import { ALL_CATALOGS } from "./bundles/all";
import { __resetI18nForTests, registerCatalog, setActiveLocale, td } from "./runtime";

/** Solo números, booleanos e identificadores: los textos (que SÍ cambian con el idioma) se dejan fuera. */
const TEXT_KEYS = new Set(["label", "name", "title", "description", "method", "copy", "headline", "detail", "note", "text", "lines", "summary", "rationale", "caption", "hint"]);
function numeric(v: unknown): unknown {
  if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
  if (Array.isArray(v)) return v.map(numeric);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (TEXT_KEYS.has(k) || typeof x === "string" || typeof x === "function") continue;
      out[k] = numeric(x);
    }
    return out;
  }
  return undefined;
}

const REG = new CardRegistry();
const OPEN_IDS = ["estandar", "premium", "oro", "masters", "champions", "icon-single", "icon"];

function snapshot(locale: Locale) {
  __resetI18nForTests();
  if (locale !== "es") registerCatalog(locale, ALL_CATALOGS[locale]);
  setActiveLocale(locale);
  const packs = PACKS.map((p) => ({ id: p.id, price: p.price, cardCount: p.cardCount }));
  const odds = PACKS.map((p) => ({ id: p.id, klass: numeric(classOddsFor(p)), icon: numeric(iconOddsFor(p)) }));
  const draws = OPEN_IDS.map((id) => {
    const pack = getPack(id)!;
    return { id, cards: [1, 7, 42, 1337, 99_991].map((seed) => openPack(REG, pack, { seed, owned: new Set(), pity: freshPity() }).decisions.map((d) => `${d.card.id}:${d.bucket}`)) };
  });
  const names = PACKS.map((p) => td(p.name));
  return { packs, odds, draws, iconBp: { ...ICON_CHANCE_BP }, names, credits: formatDRLC(80000) };
}

const ES = snapshot("es");

test("ECONOMÍA · los valores ICON aprobados siguen siendo los aprobados", () => {
  assert.deepEqual({ price: getPack("icon-single")!.price, cards: getPack("icon-single")!.cardCount }, { price: 30000, cards: 1 });
  assert.deepEqual({ price: getPack("icon")!.price, cards: getPack("icon")!.cardCount }, { price: 80000, cards: 3 });
  assert.deepEqual(ES.iconBp, { estandar: 100, premium: 500, oro: 1000, masters: 1500, champions: 2000 });
});

for (const locale of LOCALES.filter((l) => l !== "es")) {
  test(`ECONOMÍA · ${locale}: precios, cartas por sobre e identificadores idénticos a español`, () => {
    const s = snapshot(locale);
    assert.deepEqual(s.packs, ES.packs);
    assert.deepEqual(s.iconBp, ES.iconBp);
  });
  test(`ECONOMÍA · ${locale}: tablas de probabilidad idénticas (solo cambian los textos)`, () => {
    assert.deepEqual(snapshot(locale).odds, ES.odds);
  });
  test(`ECONOMÍA · ${locale}: el mismo sorteo da las mismas cartas`, () => {
    assert.deepEqual(snapshot(locale).draws, ES.draws);
  });
  test(`ECONOMÍA · ${locale}: los textos SÍ cambian y el importe conserva sus cifras`, () => {
    const s = snapshot(locale);
    assert.notDeepEqual(s.names, ES.names, "los nombres de sobre deberían estar traducidos");
    assert.equal(s.credits.replace(/\D/g, ""), "80000");
  });
}

test("ECONOMÍA · al terminar, el idioma vuelve a español", () => {
  __resetI18nForTests();
  setActiveLocale("es");
  assert.equal(td("Sobre Oro"), "Sobre Oro");
});
