import test from "node:test";
import assert from "node:assert/strict";
import { PACK_STATS, PACK_STATS_SEED, packStats } from "./packStats";
import { PACKS } from "./packs";
import { runtimePackEngine, runtimeRegistry } from "@/publisher/runtime";
import { buildPool } from "@/domain/packs/pool";
import { getCard } from "./catalog";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank, type RarityBucket } from "@/domain/packs/types";
import type { OwnedCard } from "@/domain/cards/types";

const BUCKETS: RarityBucket[] = ["common", "uncommon", "rare", "epic", "legendary"];
const PAID = PACKS.filter((p) => p.price > 0);

test("hay estadistica para todos los sobres que se compran", () => {
  for (const p of PAID) {
    assert.ok(packStats(p.id), `falta ${p.id} en PACK_STATS: regenera con npm run economy:model -- --emit`);
  }
});

test("precio y numero de cartas coinciden con el catalogo vivo", () => {
  /*
   * Es lo primero que se desincroniza: alguien cambia un precio en `data/packs` y la tienda
   * sigue enseñando el coste por rareza calculado con el precio viejo.
   */
  for (const p of PAID) {
    const s = packStats(p.id)!;
    assert.equal(s.price, p.price, `${p.id}: precio ${s.price} vs ${p.price}`);
    assert.equal(s.cardCount, p.cardCount, `${p.id}: ${s.cardCount} cartas vs ${p.cardCount}`);
  }
});

test("las rarezas IMPOSIBLES son exactamente las que el pool no tiene", () => {
  /*
   * Esto no es una tolerancia estadística: es un hecho del catálogo. Un sobre que declara
   * un 6 % de épicas sin una sola carta épica elegible está prometiendo algo que no puede
   * entregar, y la tienda tiene que decirlo.
   */
  const registry = runtimeRegistry();
  for (const p of PAID) {
    const { pool } = buildPool(registry, p);
    const expected = BUCKETS.filter((b) => (p.weights[b] ?? 0) > 0 && pool[b].length === 0);
    assert.deepEqual(packStats(p.id)!.impossible, expected, `${p.id}: rarezas imposibles`);
  }
});

test("el reparto de rareza guardado sigue siendo el que entrega el motor", () => {
  /*
   * La red que impide que la tienda mienta sin que nadie se entere. Se vuelve a medir con
   * una muestra pequeña —lo bastante para las rarezas frecuentes— y se compara.
   *
   * Solo se exige coincidencia en los buckets que representan al menos un 3 % del sorteo:
   * por debajo, una muestra de 1.200 aperturas no distingue 0,2 % de 0,4 % y el test
   * empezaría a fallar por azar, que es la peor clase de test. Los buckets raros los cubre
   * la comprobación de IMPOSIBLES, que es exacta.
   */
  const N = 1200;
  for (const p of PAID) {
    const drawn = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<RarityBucket, number>;
    let total = 0;
    let pity = { version: 1, counters: {} } as never;
    for (let i = 0; i < N; i++) {
      const r = runtimePackEngine().open(p, {
        seed: PACK_STATS_SEED + i * 7919, owned: [] as OwnedCard[], mintCounts: {}, pity, now: 0,
      });
      pity = r.pityAfter as never;
      for (const ins of r.instances) {
        const def = getCard(ins.cardId);
        if (!def) continue;
        drawn[bucketForRank(getVariant(def.variantId).rank)]++;
        total++;
      }
    }

    const stored = packStats(p.id)!;
    for (const b of BUCKETS) {
      const now = drawn[b] / total;
      const before = stored.drawn[b];
      if (before < 0.03 && now < 0.03) continue;
      assert.ok(Math.abs(now - before) < 0.04,
        `${p.id}/${b}: guardado ${(before * 100).toFixed(1)} % vs medido ${(now * 100).toFixed(1)} %`
        + " — regenera con npm run economy:model -- --emit");
    }
  }
});

test("el coste por rareza es coherente con el precio y el reparto", () => {
  // coste = precio / (cartas de ese bucket por sobre). Se recalcula desde lo guardado.
  for (const p of PAID) {
    const s = packStats(p.id)!;
    for (const b of BUCKETS) {
      const cost = s.costPerRarity[b];
      if (cost === undefined) {
        assert.ok(s.drawn[b] === 0, `${p.id}/${b}: sin coste pero con reparto ${s.drawn[b]}`);
        continue;
      }
      const perPack = s.drawn[b] * s.cardCount;
      const expected = s.price / perPack;
      assert.ok(Math.abs(cost - expected) / expected < 0.02,
        `${p.id}/${b}: coste ${cost} vs ${Math.round(expected)}`);
    }
  }
});

test("el desguace de un sobre entero nunca cubre su precio", () => {
  /*
   * La misma invariante que `salvage.test.ts` comprueba carta a carta, aquí sobre la
   * MEDIA MEDIDA del sobre completo. Si alguna vez se cumpliera, comprar sobres para
   * desguazarlos sería una impresora de créditos.
   */
  for (const p of PAID) {
    const s = packStats(p.id)!;
    assert.ok(s.meanSalvage < s.price,
      `${p.id}: desguace medio ${s.meanSalvage} sobre un precio de ${s.price}`);
  }
});

test("el reparto guardado suma uno", () => {
  for (const id of Object.keys(PACK_STATS)) {
    const sum = BUCKETS.reduce((a, b) => a + PACK_STATS[id].drawn[b], 0);
    assert.ok(Math.abs(sum - 1) < 0.005, `${id}: el reparto suma ${sum}`);
  }
});
