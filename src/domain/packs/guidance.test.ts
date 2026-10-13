import test from "node:test";
import assert from "node:assert/strict";
import { guidanceFor, cheapestPackFor } from "./guidance";
import { PACKS } from "@/data/packs";
import { packStats } from "@/data/packStats";
import { isDraft } from "./lifecycle";
import type { RarityBucket } from "./types";

// Un DRAFT (Fase 20.5) no se vende, así que no tiene guía de compra ni entra en la comparación
// de precios: se excluye de los invariantes de producto público, igual que en `packStats.test`.
const PAID = PACKS.filter((p) => p.price > 0 && !isDraft(p));
const BUCKETS: RarityBucket[] = ["common", "uncommon", "rare", "epic", "legendary"];

test("todo sobre de pago tiene una frase que lo explica", () => {
  for (const p of PAID) {
    const g = guidanceFor(p.id);
    assert.ok(g, `sin guia: ${p.id}`);
    assert.ok(g!.headline.length > 20, `${p.id}: frase demasiado corta`);
  }
});

test("el sobre gratuito no entra en las comparaciones de precio", () => {
  // No se compra, así que compararlo por coste por carta no significaría nada.
  assert.equal(guidanceFor("inicial"), null);
});

test("cada rareza tiene una via mas barata, y es un sobre real", () => {
  for (const b of BUCKETS) {
    const best = cheapestPackFor(b);
    assert.ok(best, `ninguna via para ${b}`);
    assert.ok(PACKS.some((p) => p.id === best!.packId), `sobre inexistente: ${best!.packId}`);
    assert.ok(best!.cost > 0);
  }
});

test("la via mas barata de una rareza es de verdad la mas barata", () => {
  /*
   * La afirmación central de la tienda. Si fuera falsa, estaríamos dirigiendo al jugador al
   * sobre equivocado con la autoridad de un dato medido, que es peor que no decir nada.
   */
  for (const b of BUCKETS) {
    const best = cheapestPackFor(b)!;
    for (const p of PAID) {
      const cost = packStats(p.id)?.costPerRarity[b];
      if (cost === undefined) continue;
      assert.ok(cost >= best.cost - 0.5,
        `${p.id} consigue ${b} por ${Math.round(cost)} y se anuncia ${best.packId} por ${Math.round(best.cost)}`);
    }
  }
});

test("un sobre que promete una rareza que no puede dar lo ADVIERTE", () => {
  /*
   * Hoy le pasa al sobre China: declara un 6 % de épicas y un 1 % de legendarias, y no hay
   * ni una sola carta épica o legendaria de un jugador de China en el catálogo. Cobrar 3.000
   * créditos por unas probabilidades inalcanzables no se arregla callándolo.
   */
  for (const p of PAID) {
    const s = packStats(p.id)!;
    if (s.impossible.length === 0) continue;
    const g = guidanceFor(p.id)!;
    assert.ok(g.warnings.some((w) => /No contiene/.test(w)),
      `${p.id} promete ${s.impossible.join("/")} y no lo advierte`);
  }
});

test("ningun sobre caro se vende como via para completar coleccion", () => {
  /*
   * Es la promesa falsa que la Fase 11 destapó y que esta fase cierra. Un sobre que no es la
   * vía barata de comunes o poco comunes NO puede presentarse como forma de ampliar
   * colección: tiene que llevar su advertencia.
   */
  for (const p of PAID) {
    const g = guidanceFor(p.id)!;
    const isBreadth = g.bestFor === "common" || g.bestFor === "uncommon";
    if (isBreadth) continue;
    assert.ok(g.warnings.length > 0, `${p.id} no advierte que no sirve para ampliar coleccion`);
    assert.ok(!/AMPLIAR/.test(g.headline), `${p.id} se anuncia como sobre de coleccion`);
  }
});

test("el sobre barato es la via de coleccion, y lo dice", () => {
  const g = guidanceFor("estandar")!;
  assert.ok(g.bestFor === "common" || g.bestFor === "uncommon");
  assert.ok(/AMPLIAR/.test(g.headline));
});
