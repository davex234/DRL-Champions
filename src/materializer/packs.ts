/**
 * PACK PATCH (Fase 5) — solo PERTENENCIA a pools y grupos de drop; jamás recalcula sobres.
 * Revalida cada claim de elegibilidad del F4 contra el motor REAL (`isEligible` × PACKS
 * reutilizados) con el roster resultante. Emite además los packIds cuyo cache de pool debe
 * invalidarse (incluye recrear los engines singleton — bug documentado en F4). Determinista.
 */
import { CardRegistry } from "@/collection/registry";
import { isEligible } from "@/domain/packs/pool";
import { getPack } from "@/data/packs";
import type { Player } from "@/domain/cards/types";
import type { CardSpec } from "@/card-generator";
import type { MaterializedCard, PackPatch, PackPoolEntry } from "./types";
import { buildCardDef } from "./card";

export function buildPackPatch(
  specs: CardSpec[],
  cards: MaterializedCard[],
  playerAfter: Map<string, Player>,
): PackPatch {
  const bucketOf = new Map(cards.map((c) => [c.card.id, c.rarityBucket]));
  const registry = new CardRegistry([], (id) => playerAfter.get(id));
  const byPack = new Map<string, PackPoolEntry[]>();

  for (const spec of specs) {
    const bucket = bucketOf.get(spec.cardId);
    if (!bucket) continue; // unchanged: no entra al patch
    for (const packId of spec.eligibility.packs) {
      const pack = getPack(packId);
      if (!pack || !isEligible(registry, pack, buildCardDef(spec))) continue; // revalidado
      const arr = byPack.get(packId);
      const entry: PackPoolEntry = { cardId: spec.cardId, bucket };
      if (arr) arr.push(entry);
      else byPack.set(packId, [entry]);
    }
  }

  const pools = [...byPack.entries()]
    .map(([packId, add]) => ({ packId, add: add.sort((a, b) => a.cardId.localeCompare(b.cardId)) }))
    .sort((a, b) => a.packId.localeCompare(b.packId));
  return { pools, invalidate: pools.map((p) => p.packId) };
}
