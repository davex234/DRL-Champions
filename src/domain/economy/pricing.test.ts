/**
 * FASE 57.5 · VALOR DE CARTA (`marketValue`) — la fórmula aprobada, ya en producción:
 *
 *   marketValue = redondeo( 50 × MULT[packCardClass] × 1,13^(OVR − 70) )   MULT 1/1/1/4/10/18/25
 *
 * Fija: que usa clase + OVR (no el rank), que la inversión Champions/Prime desaparece, determinismo, sin 0/negativos/
 * overflow, redondeo, monotonía con el OVR, jerarquía agregada, solapes intencionados por OVR, `instanceValue`,
 * `packStats` regenerado con esta valoración, y que F57.3/F57.4, catálogo, mercado y pagos siguen como estaban.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CardRegistry } from "@/collection/registry";
import { getPack } from "@/data/packs";
import { PACK_STATS } from "@/data/packStats";
import { openPack } from "@/domain/packs/openPack";
import { freshPity } from "@/domain/packs/pity";
import { getVariant } from "@/domain/cards/variants";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { PAYMENTS_ENABLED } from "@/config/monetization";
import {
  marketValue, instanceValue, serialMultiplier, gameRound, classValue, valueClass, legacyRankValue,
  VALUE_CLASS_MULT, VALUE_GROWTH, VALUE_SCALE, VALUE_OVR_ORIGIN,
} from "./pricing";
import { PACK_CLASS_ORDER, MAIN_PACK_LINE, MAIN_PACK_DISTRIBUTION, MAIN_PACK_PLAN, mainPackDistribution, packCardClass, type PackCardClass } from "@/domain/packs/packClass";
import { packEconomy } from "@/domain/packs/packEconomy";

const reg = new CardRegistry();
const cards = reg.cards;
const inClass = (k: PackCardClass) => cards.filter((c) => packCardClass(c) === k);
const vals = (k: PackCardClass) => inClass(k).map(marketValue);
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

test("A · marketValue = 50 × MULT[packCardClass] × 1,13^(OVR − 70), redondeado — para las 331", () => {
  assert.equal(VALUE_SCALE, 50); assert.equal(VALUE_GROWTH, 1.13); assert.equal(VALUE_OVR_ORIGIN, 70);
  assert.deepEqual({ ...VALUE_CLASS_MULT }, { base: 1, plata: 1, oro: 1, masters: 4, champions: 10, prime: 18, icon: 25 });
  for (const c of cards) {
    const cls = packCardClass(c);
    assert.ok(cls, `${c.id} sin clase`);
    assert.equal(valueClass(c), cls, "la clase económica ES packCardClass");
    assert.equal(marketValue(c), gameRound(50 * VALUE_CLASS_MULT[cls] * Math.pow(1.13, c.ovr - 70)), c.id);
  }
  // Anclas concretas (auditoría F57.5): Base 70 = 50, Masters 95 = 4.250, Champions 95 = 10.600, Prime 95 = 19.100, Icon 95 = 26.500.
  assert.equal(classValue("base", 70), 50);
  assert.equal(classValue("masters", 95), 4_250);
  assert.equal(classValue("champions", 95), 10_600);
  assert.equal(classValue("prime", 95), 19_100);
  assert.equal(classValue("icon", 95), 26_500);
});

test("B · el rank de la edición ya no manda: misma clase y OVR ⇒ mismo valor; Prime ya no queda por debajo de Champions", () => {
  // masters-l y masters-sdc (misma clase) valen igual al mismo OVR; la edición base vale igual en Base/Plata/Oro.
  assert.equal(marketValue({ variantId: "masters-l", ovr: 88 }), marketValue({ variantId: "masters-sdc", ovr: 88 }));
  // champions-s (rank 10) vs future-star (rank 7) al mismo OVR: ahora gana future-star (Prime).
  assert.ok(getVariant("champions-s").rank > getVariant("future-star").rank, "el rank sigue invertido en variants (no se toca)");
  for (let o = 80; o <= 95; o++) assert.ok(marketValue({ variantId: "future-star", ovr: o }) > marketValue({ variantId: "champions-s", ovr: o }), `OVR ${o}`);
});

test("C · sin 0, negativos, NaN ni overflow (catálogo y curva teórica 40..99)", () => {
  for (const c of cards) { const v = marketValue(c); assert.ok(Number.isSafeInteger(v) && v > 0, c.id); }
  for (const k of PACK_CLASS_ORDER) for (let o = 40; o <= 99; o++) {
    const v = classValue(k, o);
    assert.ok(Number.isSafeInteger(v) && v > 0 && v < 2 ** 31, `${k}/${o}`);
  }
});

test("D · determinismo: mismo input, mismo valor", () => {
  for (const c of cards) assert.equal(marketValue(c), marketValue({ variantId: c.variantId, ovr: c.ovr }));
});

test("E · redondeo: 1 < 50 ≤ 5 < 100 ≤ 10 < 1.000 ≤ 50 < 10.000 ≤ 100, nunca 0", () => {
  assert.equal(gameRound(47.6), 48);
  assert.equal(gameRound(56.5), 55);
  assert.equal(gameRound(137), 140);
  assert.equal(gameRound(1_337), 1_350);
  assert.equal(gameRound(13_847), 13_800);
  assert.equal(gameRound(0.2), 1);
  for (const c of cards) {
    const v = marketValue(c);
    const step = v < 50 ? 1 : v < 100 ? 5 : v < 1_000 ? 10 : v < 10_000 ? 50 : 100;
    assert.equal(v % step, 0, `${c.id}: ${v}`);
  }
});

test("F · monotonía: dentro de cada clase el valor sube ESTRICTAMENTE con el OVR (60..99), sin saltos > ×1,25", () => {
  for (const k of PACK_CLASS_ORDER) for (let o = 60; o < 99; o++) {
    const a = classValue(k, o), b = classValue(k, o + 1);
    assert.ok(b > a, `${k}: ${o}→${o + 1} (${a}→${b})`);
    assert.ok(b / a <= 1.25, `${k}: ×${(b / a).toFixed(2)}`);
  }
  // Los cortes de la edición base (81→82, 85→86) son un punto de OVR, no un salto de clase.
  assert.ok(marketValue({ variantId: "base", ovr: 82 }) / marketValue({ variantId: "base", ovr: 81 }) < 1.2);
  assert.ok(marketValue({ variantId: "base", ovr: 86 }) / marketValue({ variantId: "base", ovr: 85 }) < 1.2);
});

test("G · jerarquía agregada: medianas y medias Base < Plata < Oro < Masters < Champions < Prime < Icon (saltos ≥ 25 %, < ×3 en el tramo alto)", () => {
  const meds = PACK_CLASS_ORDER.map((k) => median(vals(k)));
  const means = PACK_CLASS_ORDER.map((k) => mean(vals(k)));
  for (let i = 1; i < meds.length; i++) {
    assert.ok(meds[i] >= meds[i - 1] * 1.25, `mediana ${PACK_CLASS_ORDER[i]} ${meds[i]} vs ${meds[i - 1]}`);
    assert.ok(means[i] >= means[i - 1] * 1.25, `media ${PACK_CLASS_ORDER[i]} ${means[i]} vs ${means[i - 1]}`);
  }
  assert.ok(median(vals("prime")) / median(vals("champions")) < 3);
  assert.ok(median(vals("icon")) / median(vals("prime")) < 3);
});

test("H · solape por OVR permitido: Masters 95 > Champions 87 · Champions 95 > Prime 87 · Prime 95 > Icon 92 · Champions 95 > Icon 87", () => {
  assert.ok(classValue("masters", 95) > classValue("champions", 87));
  assert.ok(classValue("champions", 95) > classValue("prime", 87));
  assert.ok(classValue("prime", 95) > classValue("icon", 92));
  assert.ok(classValue("champions", 95) > classValue("icon", 87));
  // Y en el catálogo real hay Champions por encima de alguna Prime (el solape existe, no se fuerza a 0).
  assert.ok(Math.max(...vals("champions")) > Math.min(...vals("prime")));
});

test("I · Prime no queda sistemáticamente por debajo de Champions (P(Champions > Prime) < 20 %)", () => {
  const C = vals("champions"), P = vals("prime");
  let w = 0; for (const a of C) for (const b of P) w += a > b ? 1 : a === b ? 0.5 : 0;
  assert.ok(w / (C.length * P.length) < 0.2, `P(C>P) = ${(w / (C.length * P.length)).toFixed(3)}`);
  assert.ok(P.filter((v) => v < median(C)).length / P.length < 0.1, "casi ninguna Prime bajo la mediana de Champions");
});

test("J · instanceValue = marketValue sin serie; con serie aplica serialMultiplier sobre el valor nuevo", () => {
  for (const c of cards) {
    assert.equal(instanceValue(c), marketValue(c), c.id);
  }
  // Ninguna edición del catálogo es serializada: la regresión se hace con una variante serializada heredada.
  assert.equal(cards.filter((c) => getVariant(c.variantId).serialized).length, 0);
  const s = { id: "x", playerId: "p", variantId: "masters-mvp", ovr: 90 } as unknown as Parameters<typeof instanceValue>[0];
  const limit = getVariant("masters-mvp").serialLimit!;
  assert.equal(instanceValue(s, 1), Math.round((marketValue(s) * serialMultiplier(1, limit)) / 25) * 25);
  assert.ok(instanceValue(s, 1) > instanceValue(s, limit));
  assert.equal(marketValue(s), legacyRankValue(s), "variante fuera del catálogo diseñado: tasación heredada por rank");
});

test("K · packStats está regenerado con esta valoración (meanValue ≈ EV analítico EXACTO del plan, ±3 %)", () => {
  // Pack Opening 3.0 · con ranuras e inclinación por OVR la media uniforme de clase ya no es el EV: se usa `packEconomy`.
  for (const id of MAIN_PACK_LINE) {
    const ev = packEconomy(id, cards).evPerPack;
    const row = PACK_STATS[id]!;
    assert.ok(Math.abs(row.meanValue / ev - 1) < 0.03, `${id}: packStats ${row.meanValue} vs analítico ${Math.round(ev)}`);
  }
});

test("K2 · reproducible: la misma semilla da el mismo valor de sobre", () => {
  for (const id of MAIN_PACK_LINE) {
    const total = (seed: number) => openPack(reg, getPack(id)!, { seed, owned: new Set(), pity: freshPity() }).decisions.reduce((a, d) => a + marketValue(d.card), 0);
    assert.equal(total(4242), total(4242));
  }
});

test("L · clases del catálogo intactas; la distribución por carta DERIVA del plan por ranuras (Pack Opening 3.0)", () => {
  // El plan exacto lo congela economyFinal.test (A) y su identidad tierIdentity.test; aquí, que la media derive de él.
  for (const id of MAIN_PACK_LINE) {
    const pl = MAIN_PACK_PLAN[id], d = MAIN_PACK_DISTRIBUTION[id];
    for (const k of PACK_CLASS_ORDER) assert.ok(Math.abs(d[k] - ((pl.cards - 1) * pl.regular[k] + pl.featured[k]) / pl.cards / 10) < 1e-9, `${id}/${k}`);
  }
  const counts = Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, inClass(k).length]));
  assert.deepEqual(counts, { base: 75, plata: 60, oro: 34, masters: 119, champions: 20, prime: 20, icon: 3 });
});

test("M/N · precios F80 y cartas por sobre de F57.4; Icon = 60.000, 3 cartas, solo Prime o Icon", () => {
  const got = Object.fromEntries(MAIN_PACK_LINE.map((id) => [id, [getPack(id)!.price, getPack(id)!.cardCount]]));
  assert.deepEqual(got, { estandar: [2500, 5], premium: [6000, 6], oro: [12000, 5], masters: [20000, 5], champions: [35000, 5], icon: [60000, 3] });
  const icon = mainPackDistribution("icon")!;
  assert.ok(Math.abs(icon.prime + icon.icon - 100) < 1e-9 && icon.prime > icon.icon);
});

test("O · catálogo = 331 cartas", () => {
  assert.equal(cards.length, 331);
});

test("P/Q · mercado y pagos siguen desactivados", () => {
  assert.equal(GLOBAL_MARKET_ENABLED, false);
  assert.equal(PAYMENTS_ENABLED, false);
});

test("UNA SOLA FÓRMULA · no queda ningún módulo con otra implementación de la valoración F57.5", () => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f) && /cardValueProposal|proposedCardValue|proposedValueFor/.test(readFileSync(p, "utf8")) && !p.endsWith("pricing.test.ts")) hits.push(p);
    }
  };
  walk(join(process.cwd(), "src"));
  assert.deepEqual(hits, []);
});
