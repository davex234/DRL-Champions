import test from "node:test";
import assert from "node:assert/strict";
import { salvageValue, salvageTotal, canSalvage, salvageableCount, SALVAGE_BY_BUCKET } from "./salvage";
import { quickSellValue, marketValue } from "./pricing";
import { CARDS } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
import { PACKS } from "@/data/packs";

test("el desguace crece con la rareza", () => {
  const b = SALVAGE_BY_BUCKET;
  assert.ok(b.common < b.uncommon);
  assert.ok(b.uncommon < b.rare);
  assert.ok(b.rare < b.epic);
  assert.ok(b.epic < b.legendary);
});

test("el desguace es SIEMPRE muy inferior al valor de mercado de la carta", () => {
  /*
   * Es la razón de ser de este módulo. Si el desguace se acercara al valor de mercado,
   * comprar sobres para desguazar sería rentable — que es exactamente lo que ocurriría
   * usando `quickSellValue` (80 % del valor de mercado).
   */
  for (const card of CARDS.slice(0, 300)) {
    const s = salvageValue(card);
    const q = quickSellValue(card);
    assert.ok(s < q, `${card.id}: desguace ${s} debería ser < venta rápida ${q}`);
  }
});

test("desguazar un sobre ENTERO devuelve menos de lo que costó", () => {
  /*
   * La propiedad que impide la impresora de dinero. Se calcula el desguace medio de un
   * sobre a partir de sus pesos por bucket declarados, sin abrir nada: es una cota
   * superior razonable y no depende del azar.
   */
  for (const pack of PACKS) {
    if (pack.price <= 0) continue;
    const total = Object.entries(pack.weights).reduce((s, [b, w]) => s + w, 0);
    if (total <= 0) continue;
    const expectedPerCard = Object.entries(pack.weights).reduce(
      (s, [b, w]) => s + (w / total) * SALVAGE_BY_BUCKET[b as keyof typeof SALVAGE_BY_BUCKET],
      0,
    );
    const perPack = expectedPerCard * pack.cardCount;
    assert.ok(
      perPack < pack.price,
      `${pack.id}: desguace esperado ${Math.round(perPack)} debe ser < precio ${pack.price}`,
    );
  }
});

test("la recuperación baja con la rareza del sobre", () => {
  // Comprar un Icon para desguazarlo no puede ser mejor negocio que comprar un Estándar.
  const recovery = (id: string) => {
    const pack = PACKS.find((p) => p.id === id)!;
    const total = Object.values(pack.weights).reduce((s, w) => s + w, 0);
    const perCard = Object.entries(pack.weights).reduce(
      (s, [b, w]) => s + (w / total) * SALVAGE_BY_BUCKET[b as keyof typeof SALVAGE_BY_BUCKET], 0);
    return (perCard * pack.cardCount) / pack.price;
  };
  assert.ok(recovery("estandar") > recovery("premium"));
  assert.ok(recovery("premium") > recovery("icon"));
});

test("el valor no depende del número de serie", () => {
  // Un #1 vale una fortuna para un coleccionista; eso es asunto del mercado, no del
  // desguace. Dos tasaciones distintas para la misma carta serían dos economías.
  const serialized = CARDS.find((c) => getVariant(c.variantId).serialized);
  if (!serialized) return;
  assert.equal(salvageValue(serialized), salvageValue(serialized));
  assert.notEqual(quickSellValue(serialized, 1), quickSellValue(serialized, 200));
});

test("solo se desguazan duplicados: la última copia nunca", () => {
  assert.equal(canSalvage(1), false);
  assert.equal(canSalvage(0), false);
  assert.equal(canSalvage(2), true);
  assert.equal(salvageableCount(1), 0);
  assert.equal(salvageableCount(3), 2);
  assert.equal(salvageableCount(0), 0);
});

test("el total de un lote es la suma de sus partes", () => {
  const lot = CARDS.slice(0, 5);
  assert.equal(salvageTotal(lot), lot.reduce((s, c) => s + salvageValue(c), 0));
  assert.equal(salvageTotal([]), 0);
});

test("cada bucket del catálogo tiene un valor de desguace definido", () => {
  // Una carta cuyo bucket no estuviera en la tabla pagaría el valor de «común» sin avisar.
  const seen = new Set(CARDS.map((c) => bucketForRank(getVariant(c.variantId).rank)));
  for (const b of seen) {
    assert.ok(SALVAGE_BY_BUCKET[b] > 0, `falta el bucket ${b}`);
  }
});

test("el desguace nunca supera el valor de mercado ni siquiera en la carta más barata", () => {
  const cheapest = [...CARDS].sort((a, b) => marketValue(a) - marketValue(b))[0];
  assert.ok(salvageValue(cheapest) < marketValue(cheapest),
    `${cheapest.id}: ${salvageValue(cheapest)} vs ${marketValue(cheapest)}`);
});
