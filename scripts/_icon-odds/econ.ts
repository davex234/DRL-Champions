/** Instrumento ICON-ODDS (fuera de CI): economía EXACTA de la línea principal con el plan vigente. `npx tsx scripts/_icon-odds/econ.ts` */
import { CARDS } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { MAIN_PACK_LINE } from "@/domain/packs/packClass";
import { packEconomy, economyOutliers } from "@/domain/packs/packEconomy";
const out: Record<string, unknown> = {};
for (const id of MAIN_PACK_LINE) {
  const p = getPack(id)!; const r = packEconomy(id, CARDS);
  out[id] = { price: p.price, cards: p.cardCount, evPerPack: Math.round(r.evPerPack), ratio: +r.ratio.toFixed(4), salvagePerPack: Math.round(r.salvagePerPack), salvageRatio: +r.salvageRatio.toFixed(4),
    pAtLeastOneIcon: +r.topTier.icon.pAtLeastOne.toFixed(6), iconPerCard: +r.topTier.icon.perCard.toFixed(6), costPerIcon: Math.round(r.topTier.icon.costPerCard),
    pAtLeastOnePrime: +r.topTier.prime.pAtLeastOne.toFixed(6), costPerPrime: Math.round(r.topTier.prime.costPerCard) };
}
console.log(JSON.stringify({ line: out, outliers: economyOutliers(CARDS) }, null, 1));
