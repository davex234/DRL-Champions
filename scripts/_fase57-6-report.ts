/**
 * FASE 57.6 · agrega la evidencia a partir de `all-pack-economy-{before,after}.json` (generados por
 * `_fase57-6-economy.ts`, 200.000 aperturas por sobre con los pools reales). Puro. Fuera de CI.
 *
 *   npx tsx scripts/_fase57-6-report.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CARDS } from "@/data/catalog";
import { PACKS } from "@/data/packs";
import { PACK_STATS } from "@/data/packStats";
import { marketValue, classValue } from "@/domain/economy/pricing";
import { salvageValue, SALVAGE_RATE, SALVAGE_FLOOR } from "@/domain/economy/salvage";
import { MAIN_PACK_LINE, MAIN_PACK_DISTRIBUTION } from "@/domain/packs/packClass";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { PAYMENTS_ENABLED } from "@/config/monetization";

const OUT = join("docs", "product", "qa", "fase57-6-economy-final");
type Row = { packId: string; name: string; status: string; buyable: boolean; lifecycle: string; price: number; cards: number; poolSize: number; ev: number; evOverPrice: number | null;
  p10: number; p50: number; p90: number; p99: number; min: number; max: number; salvageEV: number; salvageOverPrice: number | null; salvageP99: number; salvageMax: number;
  pSalvageAtLeastPrice: number | null; legacyQuickSellEV: number; legacyQuickSellOverPrice: number | null; pLegacyQuickSellAtLeastPrice: number | null;
  primePerCard: number; iconPerCard: number; pPackPrimeOrIcon: number; meanOvr: number; vsMainMedian: number | null; restrictRegion: string | null; team: string | null };
type File = { mainBand: { median: number; lo: number; hi: number }; packs: Row[] };
const load = (l: string) => JSON.parse(readFileSync(join(OUT, `all-pack-economy-${l}.json`), "utf8")) as File;
const before = load("before"), after = load("after");
const save = (f: string, d: unknown) => writeFileSync(join(OUT, f), JSON.stringify(d, null, 2));
const r2 = (x: number) => Math.round(x * 100) / 100;

/* baseline: el estado canónico comprobado ANTES de tocar nada (los precios «before» salen de all-pack-economy-before) */
save("baseline.json", {
  catalog: CARDS.length, mainPrices: Object.fromEntries(before.packs.filter((r) => MAIN_PACK_LINE.includes(r.packId)).map((r) => [r.packId, [r.price, r.cards]])),
  classDistribution: MAIN_PACK_DISTRIBUTION,
  marketValueAnchors: { base70: classValue("base", 70), masters95: classValue("masters", 95), champions95: classValue("champions", 95), prime95: classValue("prime", 95), icon95: classValue("icon", 95) },
  salvage: { rate: SALVAGE_RATE, floor: SALVAGE_FLOOR },
  GLOBAL_MARKET_ENABLED, PAYMENTS_ENABLED,
  gates: { tests: "5036/5036", tscWeb: "0 errores", tscScripts: "0 errores" },
  pricesBefore: Object.fromEntries(before.packs.map((r) => [r.packId, r.price])),
});

/* dominancia (sobre el estado BEFORE) */
const five = before.packs.filter((r) => MAIN_PACK_LINE.includes(r.packId) && r.packId !== "icon");
const mainPrimeCost = Math.min(...five.map((r) => r.price / (r.primePerCard * r.cards)));
const dom = before.packs.filter((r) => r.price > 0).map((r) => {
  const above = r.evOverPrice != null && r.evOverPrice > before.mainBand.hi;
  return {
    packId: r.packId, name: r.name, lifecycle: r.lifecycle, buyable: r.buyable, price: r.price,
    evOverPrice: r.evOverPrice, vsMainMedianPct: r.vsMainMedian, salvageOverPrice: r.salvageOverPrice,
    primePerCard: r.primePerCard, iconPerCard: r.iconPerCard, meanOvr: r.meanOvr, p90: r.p90, p99: r.p99, poolSize: r.poolSize,
    creditsPerPrime: r.primePerCard > 0 ? Math.round(r.price / (r.primePerCard * r.cards)) : null,
    verdict: MAIN_PACK_LINE.includes(r.packId) ? (r.packId === "icon" ? "PREMIUM (excepción intencional)" : Math.abs((r.vsMainMedian ?? 0)) <= 12 ? "EN BANDA" : "FUERA DE BANDA")
      : !r.buyable ? `NO COMPRABLE (${r.lifecycle})` : above ? "ECONOMICALLY DOMINANT" : (r.evOverPrice ?? 0) < before.mainBand.lo ? "BAJO LA BANDA (peor compra, no explotable)" : "EN BANDA",
  };
});
save("dominance-analysis.json", { band: before.mainBand, rule: "DOMINANT = EV/precio > mediana×1,12 de la línea principal Y comprable repetidamente (ACTIVE, precio > 0, sin tope)", mainLineBestCreditsPerPrime: Math.round(mainPrimeCost), packs: dom });

/* liquidación: desguace (servidor y ahora local) y la venta rápida local ANTERIOR (80 %) */
save("liquidation-analysis.json", {
  sourceOfTruth: "salvageValue(card) = max(5, redondeo(6 % × marketValue)) — servidor (app_salvage_cards), modo local (useGameStore.quickSell*) y Forja (salvageYield)",
  legacyLocalQuickSell: "80 % de instanceValue, redondeado a 5 (eliminado en la F57.6)",
  packs: after.packs.filter((r) => r.buyable).map((r) => {
    const b = before.packs.find((x) => x.packId === r.packId)!;
    return { packId: r.packId, price: r.price, salvageEV: r.salvageEV, salvageOverPrice: r.salvageOverPrice, salvageP99: r.salvageP99, salvageMax: r.salvageMax,
      pSalvageAtLeastPrice: r.pSalvageAtLeastPrice, legacyQuickSellOverPriceBefore: b.legacyQuickSellOverPrice, pLegacyQuickSellAtLeastPriceBefore: b.pLegacyQuickSellAtLeastPrice };
  }),
  maxSalvageOverPrice: Math.max(...after.packs.filter((r) => r.buyable).map((r) => r.salvageOverPrice ?? 0)),
  maxLegacyQuickSellOverPriceBefore: Math.max(...before.packs.filter((r) => r.buyable).map((r) => r.legacyQuickSellOverPrice ?? 0)),
  cardLevel: { maxSalvageOverValue: r2(Math.max(...CARDS.map((c) => salvageValue(c) / marketValue(c)))), maxSalvage: Math.max(...CARDS.map(salvageValue)), minSalvage: Math.min(...CARDS.map(salvageValue)) },
  jackpotVsArbitrage: "P(desguace ≥ precio) > 0 en algunos sobres = premio aleatorio (una Icon/Prime alta): no es repetible ni elegible. Arbitraje sistemático = comprar una carta concreta por menos de lo que paga su desguace: imposible (sin cartas a la venta por créditos, mercado OFF, suelo de banda 0,2 > desguace máx 0,10).",
});

/* tabla final */
const final = after.packs.map((r) => ({
  pack: r.name, packId: r.packId, tipo: MAIN_PACK_LINE.includes(r.packId) ? "línea principal" : r.team ? "equipo" : r.restrictRegion ? "regional" : r.price === 0 ? "inicial" : "especial",
  precio: r.price, precioAntes: before.packs.find((x) => x.packId === r.packId)!.price, cartas: r.cards, ev: r.ev, evPrecio: r.evOverPrice, salvageEV: r.salvageEV, salvagePrecio: r.salvageOverPrice,
  primePct: r2(r.primePerCard * 100), iconPct: r2(r.iconPerCard * 100),
  estado: r.price === 0 ? "RECOMPENSA" : r.lifecycle !== "ACTIVE" ? "NO COMPRABLE" : r.packId === "icon" ? "PREMIUM" : "OK",
  packStatsMatchesPrice: PACK_STATS[r.packId]?.price === PACKS.find((p) => p.id === r.packId)!.price,
}));
save("final-pack-economy.json", { band: after.mainBand, packs: final });
console.log(final.map((f) => `${f.packId.padEnd(14)} ${String(f.precioAntes).padStart(6)}→${String(f.precio).padStart(6)} EV/p ${f.evPrecio ?? "—"} desguace/p ${f.salvagePrecio ?? "—"} ${f.estado}`).join("\n"));
