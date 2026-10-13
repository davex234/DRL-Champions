/**
 * FASE 57.6 · CIERRE DE LA ECONOMÍA DE SOBRES — congela lo decidido en F57.3, F57.4, F57.5B y F57.6.
 *
 *   A. probabilidades F57.3 · B. precios de la línea principal · C. marketValue · D. desguace · E. Icon · F. 331 cartas
 *   G. liquidar TODO < 70 % del precio en cada sobre comprable · H. sin arbitraje sistemático · I. sin venta rápida al 80 %
 *   J. pools de los especiales intactos · K. una sola fuente de precio (sobre = tienda = packStats) · L. Sobre Inicial
 *   M/N. mercado y pagos OFF · además: ningún sobre especial comprable domina a la línea principal en valor por crédito.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as pricing from "./pricing";
import { marketValue, classValue } from "./pricing";
import { salvageValue, SALVAGE_RATE, SALVAGE_FLOOR } from "./salvage";
import { STARTER_POLICY } from "./starter";
import { CARDS } from "@/data/catalog";
import { PACKS, getPack } from "@/data/packs";
import { PACK_STATS } from "@/data/packStats";
import { STORE_CATALOG } from "@/data/storeCatalog";
import { resolveAll } from "@/domain/store/resolve";
import { isPurchasable, packLifecycle } from "@/domain/packs/lifecycle";
import { MAIN_PACK_LINE, MAIN_PACK_PLAN, mainPackDistribution } from "@/domain/packs/packClass";
import { salvageYield } from "@/craft/materials";
import { getVariant } from "@/domain/cards/variants";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { PAYMENTS_ENABLED } from "@/config/monetization";

const buyable = PACKS.filter((p) => p.price > 0 && isPurchasable(p));
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("A · PACK OPENING 3.0: el plan por ranuras (por mil) e inclinación por OVR, congelados", () => {
  // La tabla F57.3 (una sola por carta, uniforme dentro de la clase) se sustituyó el 2026-10-07: el contrato completo vive
  // en `MAIN_PACK_PLAN` y su identidad estadística la fija `src/domain/packs/tierIdentity.test.ts`.
  const z = { base: 0, plata: 0, oro: 0, masters: 0, champions: 0, prime: 0, icon: 0 };
  assert.deepEqual(JSON.parse(JSON.stringify(MAIN_PACK_PLAN)), {
    estandar: { cards: 5, ovrTilt: 0.3, regular: { ...z, base: 720, plata: 250, oro: 30 }, featured: { ...z, base: 250, plata: 400, oro: 200, masters: 100, champions: 30, prime: 15, icon: 5 } },
    premium: { cards: 6, ovrTilt: 0.22, regular: { ...z, plata: 820, oro: 150, masters: 30 }, featured: { ...z, plata: 150, oro: 395, masters: 290, champions: 100, prime: 50, icon: 15 } },
    oro: { cards: 5, ovrTilt: 0.12, regular: { ...z, oro: 700, masters: 270, champions: 30 }, featured: { ...z, oro: 200, masters: 350, champions: 220, prime: 150, icon: 80 } },
    masters: { cards: 5, ovrTilt: 0.03, regular: { ...z, oro: 350, masters: 520, champions: 130 }, featured: { ...z, masters: 300, champions: 290, prime: 260, icon: 150 } },
    champions: { cards: 5, ovrTilt: 0, regular: { ...z, oro: 200, masters: 330, champions: 400, prime: 70 }, featured: { ...z, champions: 300, prime: 420, icon: 280 } },
    icon: { cards: 3, ovrTilt: 0, regular: { ...z, prime: 720, icon: 280 }, featured: { ...z, prime: 500, icon: 500 } },
  });
});

test("B · F80: precios y cartas de la línea principal (cartas por sobre de F57.4)", () => {
  assert.deepEqual(MAIN_PACK_LINE.map((id) => [id, getPack(id)!.price, getPack(id)!.cardCount]), [
    ["estandar", 2500, 5], ["premium", 6000, 6], ["oro", 12000, 5], ["masters", 20000, 5], ["champions", 35000, 5], ["icon", 60000, 3],
  ]);
});

test("C · F57.5B: marketValue = 50 × MULT × 1,13^(OVR−70) (anclas)", () => {
  assert.deepEqual(
    [classValue("base", 70), classValue("plata", 84), classValue("oro", 90), classValue("masters", 95), classValue("champions", 95), classValue("prime", 95), classValue("icon", 95)],
    [50, 280, 580, 4_250, 10_600, 19_100, 26_500],
  );
});

test("D · desguace = max(5, redondeo(6 % × marketValue)) y ninguna carta lo supera ni lo iguala", () => {
  assert.equal(SALVAGE_RATE, 0.06); assert.equal(SALVAGE_FLOOR, 5);
  for (const c of CARDS) { const s = salvageValue(c); assert.ok(s > 0 && s < marketValue(c), c.id); }
  assert.deepEqual([salvageValue({ variantId: "base", ovr: 70 }), salvageValue({ variantId: "future-star", ovr: 95 }), salvageValue({ variantId: "moments", ovr: 95 })], [5, 1150, 1600]);
});

test("E · Icon: 60.000 créditos (F80), 3 cartas, solo Prime o Icon (media por carta ≈ 64,7 % / 35,3 %)", () => {
  const icon = getPack("icon")!;
  assert.equal(icon.price, 60_000); assert.equal(icon.cardCount, 3);
  const d = mainPackDistribution("icon")!;
  assert.ok(Math.abs(d.prime - 194 / 3) < 1e-9 && Math.abs(d.icon - 106 / 3) < 1e-9, JSON.stringify(d));
  assert.ok(Math.abs(d.prime + d.icon - 100) < 1e-9);
});

test("F · catálogo = 331", () => { assert.equal(CARDS.length, 331); });

test("G · liquidar TODO lo que sale de un sobre comprable devuelve < 70 % de su precio (packStats, motor real)", () => {
  assert.ok(buyable.length >= 15);
  for (const p of buyable) {
    const row = PACK_STATS[p.id];
    assert.ok(row, `${p.id}: sin packStats`);
    assert.ok(row.meanSalvage / p.price < 0.7, `${p.id}: ${row.meanSalvage}/${p.price}`);
    assert.ok(row.meanSalvage / p.price < 0.45, `${p.id}: fuera del objetivo 20–40 % (+margen)`);
  }
});

test("H · sin arbitraje sistemático: el peor sobre posible nunca paga su precio y no hay cartas sueltas a la venta por créditos", () => {
  for (const p of buyable) {
    const minSalvage = Math.min(...CARDS.map(salvageValue));
    assert.ok(p.cardCount * minSalvage < p.price, p.id);
  }
  // La única forma determinista de conseguir una carta concreta sería comprarla: ningún producto suelto tiene precio en créditos.
  for (const o of [...STORE_CATALOG.cardOffers, ...STORE_CATALOG.boxOffers, ...STORE_CATALOG.bundleOffers] as unknown as { id: string; gameCurrencyPrice?: number | null; purchaseMode: string }[]) {
    assert.ok(o.gameCurrencyPrice == null || o.purchaseMode === "REAL_MONEY", `${o.id}: precio en créditos`);
  }
  assert.equal(GLOBAL_MARKET_ENABLED, false, "con el mercado cerrado no se puede comprar una carta concreta a otro jugador");
});

test("I · no queda venta rápida al 80 %: el modo local y la Forja liquidan con salvageValue", () => {
  assert.equal("quickSellValue" in pricing, false);
  assert.equal("QUICK_SELL_RATE" in pricing, false);
  for (const f of ["src/store/useGameStore.ts", "src/app/inventario/page.tsx", "src/craft/materials.ts"]) {
    const s = src(f);
    assert.ok(!/quickSellValue|QUICK_SELL_RATE|\* 0\.8\b/.test(s), `${f}: rastro del 80 %`);
    assert.ok(s.includes("salvageValue"), `${f}: no usa salvageValue`);
  }
  for (const c of CARDS.slice(0, 50)) {
    assert.equal(salvageYield(c, getVariant(c.variantId), undefined, { valueFromCard: true }).credits, salvageValue(c), c.id);
  }
});

test("J · los sobres especiales conservan cartas, pesos, restricciones, equipo y ciclo de vida", () => {
  const snap = Object.fromEntries(PACKS.filter((p) => !MAIN_PACK_LINE.includes(p.id)).map((p) => [p.id,
    `${p.cardCount}|${JSON.stringify(p.weights)}|${p.guaranteedMin ?? ""}|${p.restrictRegion ?? ""}|${p.team ?? ""}|${packLifecycle(p)}`]));
  const R = '{"common":35,"uncommon":40,"rare":18,"epic":6,"legendary":1}', C = '{"common":35,"uncommon":40,"rare":18,"epic":0,"legendary":0}';
  assert.deepEqual(snap, {
    inicial: '5|{"common":70,"uncommon":26,"rare":3.5,"epic":0.5,"legendary":0}||||ACTIVE',
    ewc: '5|{"common":8,"uncommon":38,"rare":32,"epic":19,"legendary":3}|epic|||ACTIVE',
    emea: `5|${R}||EMEA||ACTIVE`, americas: `5|${R}||Americas||ACTIVE`, pacific: `5|${R}||Pacific||ACTIVE`, china: `5|${C}||China||ACTIVE`,
    "team-heretics": `5|${R}||EMEA|Team Heretics|ACTIVE`, "team-fnatic": `5|${R}||EMEA|Fnatic|ACTIVE`, "team-navi": `5|${R}||EMEA|NAVI|RETIRED`,
    "team-g2": `5|${R}||Americas|G2|ACTIVE`, prime: '4|{"common":0,"uncommon":25,"rare":35,"epic":30,"legendary":10}|epic|||RETIRED',
    "team-loud": `5|${R}||Americas|LOUD|DRAFT`, "team-blg": `5|${C}||China|BLG|DRAFT`, "team-te": `5|${C}||China|TE|DRAFT`, "team-jdg": `5|${C}||China|JDG|DRAFT`,
    "team-liquid": `5|${R}||EMEA|TL|ACTIVE`, "team-tyl": `5|${C}||China|TYL|DRAFT`, "team-karmine": `5|${R}||EMEA|KC|ACTIVE`, "team-m8": `5|${R}||EMEA|M8|DRAFT`,
    "team-fut": `5|${R}||EMEA|FUT|DRAFT`, "team-100t": `5|${R}||Americas|100T|DRAFT`, "team-prx": `5|${R}||Pacific|PRX|DRAFT`, "team-ns": `5|${R}||Pacific|NS|DRAFT`,
    "team-ge": `5|${R}||Pacific|GE|DRAFT`, "team-xlg": `5|${C}||China|XLG|DRAFT`, "team-lev": `5|${R}||Americas|LEV|DRAFT`,
  });
});

test("K · una sola fuente de precio: PackDef = tienda = packStats (F57.6 EMEA/Americas/Pacific 3.500; Pack Opening 3.1 China 9.500)", () => {
  for (const p of PACKS) if (PACK_STATS[p.id]) assert.equal(PACK_STATS[p.id].price, p.price, `${p.id}: packStats desfasado`);
  for (const r of resolveAll(Date.now())) {
    if (r.kind !== "PACK") continue;
    const credits = r.options.find((o) => o.method === "GAME_CURRENCY");
    if (credits && credits.price != null) assert.equal(credits.price, getPack(r.packId!)!.price, r.productId);
  }
  for (const p of PACKS.filter((x) => x.restrictRegion)) {
    assert.equal(p.price, p.restrictRegion === "China" ? 9500 : 3500, p.id);
  }
});

test("DOMINANCIA · Pack Opening 3.1: ningún sobre especial comprable domina la línea ni supera el valor por crédito del Plata", () => {
  const dominantWith = (priceOf: (id: string) => number) => {
    const five = MAIN_PACK_LINE.filter((id) => id !== "icon").map((id) => PACK_STATS[id].meanValue / priceOf(id)).sort((a, b) => a - b);
    const median = five[2];
    return {
      lineOutliers: five.filter((r) => Math.abs(r / median - 1) > 0.12).length,
      dominant: buyable.filter((x) => !MAIN_PACK_LINE.includes(x.id) && PACK_STATS[x.id].meanValue / priceOf(x.id) > median * 1.12).map((x) => x.id).sort(),
    };
  };
  // PACK OPENING 3.0 (2026-10-07) · la línea ya no busca una banda plana: su valor por crédito sube ESTRICTAMENTE de
  // Bronce a Icon (ahorrar compensa). Comprobarlo con los precios de F57.4 ya no tiene sentido (otra distribución).
  const line = MAIN_PACK_LINE.map((id) => PACK_STATS[id].meanValue / getPack(id)!.price);
  for (let i = 1; i < line.length; i++) assert.ok(line[i] > line[i - 1], `valor por crédito no creciente en ${MAIN_PACK_LINE[i]}: ${line.map((x) => x.toFixed(3))}`);
  // F80 dejó a TODOS los especiales comprables dominando la línea (5–6× su valor por crédito). PACK OPENING 3.1 lo cierra:
  // ninguno domina, y ninguno rinde por crédito más que el Sobre Plata (su ventaja es el targeting, no el valor).
  const now = dominantWith((id) => getPack(id)!.price);
  assert.deepEqual(now.dominant, [], "ningún especial comprable domina la línea principal");
  const plata = PACK_STATS.premium.meanValue / getPack("premium")!.price;
  for (const p of buyable.filter((x) => !MAIN_PACK_LINE.includes(x.id))) assert.ok(PACK_STATS[p.id].meanValue / p.price < plata, `${p.id}: ${(PACK_STATS[p.id].meanValue / p.price).toFixed(3)} ≥ Plata ${plata.toFixed(3)}`);
});

test("L · Sobre Inicial / FTUE intacto: gratis, 5 cartas, regla del servidor", () => {
  const p = getPack("inicial")!;
  assert.equal(p.price, 0); assert.equal(p.cardCount, 5); assert.equal(STARTER_POLICY.packId, "inicial");
});

test("M/N · mercado y pagos siguen desactivados", () => {
  assert.equal(GLOBAL_MARKET_ENABLED, false);
  assert.equal(PAYMENTS_ENABLED, false);
});
