import { packEconomy, economyOutliers } from "@/domain/packs/packEconomy";
import { CARDS } from "@/data/catalog";
import { MAIN_PACK_LINE } from "@/domain/packs/packClass";
for (const id of MAIN_PACK_LINE) { const e = packEconomy(id, CARDS); console.log(id, e.ratio.toFixed(4), "salv", e.salvageRatio.toFixed(4), "prime≥1", e.topTier.prime.pAtLeastOne.toFixed(6), "icon≥1", e.topTier.icon.pAtLeastOne.toFixed(6), "€/prime", Math.round(e.topTier.prime.costPerCard), "€/icon", Math.round(e.topTier.icon.costPerCard)); }
console.log(JSON.stringify(economyOutliers(CARDS)));
