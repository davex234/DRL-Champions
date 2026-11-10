import { PACK_STATS } from "@/data/packStats";
import { CARDS } from "@/data/catalog";
import { marketValue } from "@/domain/economy/pricing";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
import { BASE_LINE } from "@/domain/packs/power";
import { MAIN_PACK_LINE } from "@/domain/packs/packClass";
const B = ["common", "uncommon", "rare", "epic", "legendary"] as const;
for (const [name, ladder] of [["BASE_LINE primera", BASE_LINE], ["MAIN mínimo", MAIN_PACK_LINE]] as const) {
  const out: string[] = [];
  for (const b of B) {
    const costs = ladder.map((id) => PACK_STATS[id]?.costPerRarity[b]).filter((c): c is number => !!c && c > 0);
    const cost = name.startsWith("BASE") ? costs[0] : Math.min(...costs);
    const v = CARDS.filter((c) => bucketForRank(getVariant(c.variantId).rank) === b).map(marketValue);
    out.push(`${b} ${(v.reduce((a, x) => a + x, 0) / v.length / cost).toFixed(2)}`);
  }
  console.log(name, out.join(" · "));
}
