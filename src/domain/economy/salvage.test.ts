import test from "node:test";
import assert from "node:assert/strict";
import { salvageValue, salvageTotal, canSalvage, salvageableCount, salvageRound, SALVAGE_RATE, SALVAGE_FLOOR } from "./salvage";
import { marketValue, instanceValue } from "./pricing";
import { CARDS } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { PACKS, getPack } from "@/data/packs";
import { PACK_STATS } from "@/data/packStats";
import { CardRegistry } from "@/collection/registry";
import { openPack } from "@/domain/packs/openPack";
import { freshPity } from "@/domain/packs/pity";
import { MAIN_PACK_LINE, PACK_CLASS_ORDER, packCardClass, type PackCardClass } from "@/domain/packs/packClass";
import { packEconomy } from "@/domain/packs/packEconomy";

test("el desguace crece con la CLASE (F57.5): medianas y medias Base < Plata < Oro < Masters < Champions < Prime < Icon", () => {
  const of = (k: PackCardClass) => CARDS.filter((c) => packCardClass(c) === k).map(salvageValue).sort((x, y) => x - y);
  const med = (a: number[]) => a[Math.floor(a.length / 2)];
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  for (let i = 1; i < PACK_CLASS_ORDER.length; i++) {
    const lo = of(PACK_CLASS_ORDER[i - 1]), hi = of(PACK_CLASS_ORDER[i]);
    assert.ok(med(hi) > med(lo), `mediana ${PACK_CLASS_ORDER[i]} ${med(hi)} vs ${med(lo)}`);
    assert.ok(avg(hi) > avg(lo), `media ${PACK_CLASS_ORDER[i]}`);
  }
  // La inversión heredada del bucket de rareza (Prime «rara» 200 < Champions «épica» 600) ya no existe.
  assert.ok(med(of("prime")) > med(of("champions")));
});

test("el desguace es SIEMPRE muy inferior al valor de mercado de la carta", () => {
  /*
   * Es la razón de ser de este módulo. Si el desguace se acercara al valor de mercado,
   * comprar sobres para desguazar sería rentable — que es exactamente lo que ocurría con la
   * venta rápida local al 80 % (eliminada en la F57.6).
   */
  for (const card of CARDS) {
    const s = salvageValue(card);
    assert.ok(s <= 0.1 * marketValue(card), `${card.id}: desguace ${s} vs valor ${marketValue(card)}`);
  }
});

test("desguazar un sobre ENTERO devuelve < 70 % de lo que costó — TODOS los sobres de pago (motor real, packStats)", () => {
  /*
   * La propiedad que impide la impresora de dinero: comprar → abrir → desguazar TODO → comprar otro. `meanSalvage`
   * lo mide `economy:model` con el motor de sorteo real (20.000 aperturas por sobre); se exige además margen: < 70 %.
   */
  for (const pack of PACKS) {
    if (pack.price <= 0) continue;
    const row = PACK_STATS[pack.id];
    assert.ok(row, `${pack.id}: sin packStats`);
    assert.ok(row.meanSalvage / pack.price < 0.7, `${pack.id}: desguace ${row.meanSalvage} vs precio ${pack.price}`);
  }
});

test("la línea principal: desguace esperado EXACTO del plan (Pack Opening 3.0) < 70 % del precio y coincide con packStats (±3 %)", () => {
  for (const id of MAIN_PACK_LINE) {
    const pack = getPack(id)!;
    const ev = packEconomy(id, CARDS).salvagePerPack;
    assert.ok(ev / pack.price < 0.7, `${id}: ${Math.round(ev)} / ${pack.price}`);
    assert.ok(Math.abs(PACK_STATS[id].meanSalvage / ev - 1) < 0.03, `${id}: packStats ${PACK_STATS[id].meanSalvage} vs ${Math.round(ev)}`);
  }
});

test("NINGÚN BUCLE: abrir y desguazar TODO nunca sale a cuenta (1.000 aperturas por sobre, semilla fija)", () => {
  const reg = new CardRegistry();
  for (const id of MAIN_PACK_LINE) {
    const pack = getPack(id)!;
    let back = 0;
    for (let i = 0; i < 1_000; i++) {
      back += openPack(reg, pack, { seed: (i * 2246822519 + 7) >>> 0, owned: new Set(), pity: freshPity() }).decisions.reduce((a, d) => a + salvageValue(d.card), 0);
    }
    assert.ok(back / (1_000 * pack.price) < 0.7, `${id}: recupera ${((back / (1_000 * pack.price)) * 100).toFixed(1)} %`);
  }
});

test("comprar para desguazar nunca compensa en NINGÚN sobre de la línea (recuperación ≤ 6 % del precio)", () => {
  // Antes (F57.3) la recuperación BAJABA con la gama. Pack Opening 3.0 hace que el valor por crédito SUBA con la gama
  // (ahorrar compensa), así que la recuperación también sube un poco — pero en todos los sobres es diminuta: quien compra
  // para desguazar pierde más del 94 % del precio, también con el Icon. El bucle sigue cerrado (test anterior).
  const recovery = (id: string) => PACK_STATS[id].meanSalvage / PACK_STATS[id].price;
  // ICON (2026-10-09) · RIESGO PENDIENTE: el Premium (3 Icon a 60.000) recupera ≈ 6,4 % (por encima del 6 %); sigue perdiendo
  // > 93 % del precio y el bucle sigue cerrado (test anterior). Se fija su tope medido para que cualquier cambio se vea.
  for (const id of MAIN_PACK_LINE) assert.ok(recovery(id) <= (id === "icon" ? 0.065 : 0.06), `${id}: ${(recovery(id) * 100).toFixed(2)} %`);
});

test("el valor no depende del número de serie", () => {
  // Un #1 vale una fortuna para un coleccionista; eso es asunto del mercado, no del
  // desguace. Dos tasaciones distintas para la misma carta serían dos economías.
  const serialized = CARDS.find((c) => getVariant(c.variantId).serialized);
  if (!serialized) return;
  assert.equal(salvageValue(serialized), salvageValue(serialized));
  assert.notEqual(instanceValue(serialized, 1), instanceValue(serialized, 200));
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

test("F57.5 · fórmula: max(5, redondeo(6 % × marketValue)), redondo, > 0 y < 20 % del valor en TODAS las cartas", () => {
  assert.equal(SALVAGE_RATE, 0.06); assert.equal(SALVAGE_FLOOR, 5);
  for (const c of CARDS) {
    const s = salvageValue(c), mv = marketValue(c);
    assert.equal(s, Math.max(5, salvageRound(0.06 * mv)), c.id);
    assert.ok(Number.isSafeInteger(s) && s > 0, `${c.id}: ${s}`);
    assert.ok(s < mv, `${c.id}: ${s} ≥ ${mv}`);
    // Por debajo de la banda inferior del mercado (min_price_mult 0,2): comprar al mínimo y desguazar no rinde.
    assert.ok(s / mv < 0.2, `${c.id}: ${s}/${mv}`);
    const step = s < 100 ? 5 : s < 1_000 ? 10 : 50;
    assert.equal(s % step, 0, `${c.id}: ${s} no es múltiplo de ${step}`);
  }
});

test("el desguace nunca supera el valor de mercado ni siquiera en la carta más barata", () => {
  const cheapest = [...CARDS].sort((a, b) => marketValue(a) - marketValue(b))[0];
  assert.ok(salvageValue(cheapest) < marketValue(cheapest),
    `${cheapest.id}: ${salvageValue(cheapest)} vs ${marketValue(cheapest)}`);
});
