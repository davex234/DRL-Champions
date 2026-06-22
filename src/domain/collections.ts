import type { Region } from "@/domain/cards/types";
import { CARDS, getPlayer } from "@/data/catalog";

/**
 * Colecciones generadas automáticamente por región a partir del catálogo
 * (EMEA / Americas / Pacific / China). Se recalculan al cambiar el roster.
 */
export interface RegionCollection {
  id: string;
  name: string;
  region: Region;
  cardIds: string[];
}

const REGIONS: Region[] = ["EMEA", "Americas", "Pacific", "China"];
const NAME: Record<Region, string> = {
  EMEA: "EMEA Collection",
  Americas: "Americas Collection",
  Pacific: "Pacific Collection",
  China: "China Collection",
};

export function regionCollections(): RegionCollection[] {
  return REGIONS.map((region) => ({
    id: `coll-${region.toLowerCase()}`,
    name: NAME[region],
    region,
    cardIds: CARDS.filter((c) => getPlayer(c.playerId)?.region === region).map((c) => c.id),
  }));
}

export function collectionProgress(coll: RegionCollection, owned: Set<string>) {
  const total = coll.cardIds.length;
  const have = coll.cardIds.filter((id) => owned.has(id)).length;
  return { owned: have, total, pct: total ? Math.round((have / total) * 100) : 0 };
}
