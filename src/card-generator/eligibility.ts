/**
 * ELIGIBILITY ENGINE (Fase 4) — calcula en qué packs/craft/mercado ENCAJARÁ cada carta,
 * REUTILIZANDO únicamente los motores reales: `isEligible` (domain/packs) contra los `PACKS`
 * de datos, y `decideMarket` (live). No duplica ni una regla; no modifica nada. El registry
 * es una simulación LIGERA (cards=[] + lookup inyectado): isEligible solo usa variant+player.
 */
import { CardRegistry } from "@/collection/registry";
import { isEligible } from "@/domain/packs/pool";
import { PACKS } from "@/data/packs";
import { decideMarket } from "@/live/market";
import { getVariant } from "@/domain/cards/variants";
import type { CardDef, Player } from "@/domain/cards/types";
import type { RarityTier } from "@/intel/decide";
import type { CardEligibility } from "./types";

/** Registry de simulación para isEligible (solo variant/player; sin catálogo). */
export function simRegistry(lookup: (id: string) => Player | undefined): CardRegistry {
  return new CardRegistry([], lookup);
}

export function buildEligibility(
  card: CardDef,
  family: string,
  tier: RarityTier,
  registry: CardRegistry,
  predictedForPlayer: CardDef[],
): CardEligibility {
  const market = decideMarket(family, tier);
  const packs = market.inPacks
    ? PACKS.filter((p) => isEligible(registry, p, card)).map((p) => p.id)
    : [];
  const rank = getVariant(card.variantId).rank;
  const upgradeTargets = predictedForPlayer
    .filter((c) => getVariant(c.variantId).rank > rank)
    .sort((a, b) => getVariant(a.variantId).rank - getVariant(b.variantId).rank || a.id.localeCompare(b.id))
    .map((c) => c.id);
  return { packs, craft: { salvage: true, upgradeTargets }, market };
}
