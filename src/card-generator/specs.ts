/**
 * CARD SPEC BUILDER (Fase 4) — construye la definición editorial de cada carta con la
 * MATEMÁTICA EXACTA del catálogo: REUTILIZA `cardsForPlayer`/`variantsForAccolade` (data/catalog)
 * y `getVariant` — jamás inventa cálculos: `spec.stats/ovr` son byte-idénticos a lo que
 * `rebuildCatalog` producirá cuando F5 materialice las accolades. Determinista.
 */
import { cardsForPlayer, variantsForAccolade } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
import { marketValue } from "@/domain/economy/pricing";
import type { CardDef, Player, AccoladeId, VariantId } from "@/domain/cards/types";
import type { CardDecision } from "@/intel/decide";
import type { CardSpec, CardSpecKind } from "./types";

/** Familia (accolade) → tipo editorial de carta. */
export function kindForFamily(family: string): CardSpecKind {
  if (family === "tournament-mvp" || family.endsWith("-mvp")) return "mvp";
  if (family === "tournament-champion" || family.endsWith("-winner")) return "champion";
  if (family.startsWith("tournament-")) return "award";
  if (family === "prime" || family === "icon" || family === "hall-of-fame" || family === "game-changers") return "exclusive";
  if (family === "base") return "base";
  return "participation";
}

/** Serie de una variante (convención del CardRegistry de Collection). */
export function seriesOf(variantId: VariantId): string {
  if (variantId.startsWith("masters")) return "masters";
  if (variantId.startsWith("champions")) return "champions";
  if (variantId.startsWith("ewc")) return "ewc";
  if (variantId === "icon-series" || variantId === "hall-of-fame" || variantId === "prime") return "icon";
  return getVariant(variantId).group;
}

/**
 * Jugador tras aplicar las accolades concedidas (SIN mutar el original) + su catálogo
 * predicho (cardsForPlayer = generador oficial del catálogo, reutilizado).
 */
export function predictCatalog(base: Player, granted: AccoladeId[]): { after: Player; cards: CardDef[] } {
  const accolades = [...new Set([...base.accolades, ...granted])];
  const after: Player = { ...base, accolades };
  return { after, cards: cardsForPlayer(after) };
}

export interface SpecSeed {
  player: Player;            // jugador base (roster o draft)
  granted: AccoladeId[];     // accolades concedidas en esta generación
  family: string;            // familia de ESTA carta (accolade u "base")
  variantId: VariantId;
  decision: CardDecision;
  forcedVariant?: boolean;
}

/** Variantes NUEVAS que produce una accolade (excluyendo las que el jugador ya tenía). */
export function newVariantsFor(player: Player, accolade: AccoladeId): VariantId[] {
  const before = new Set(cardsForPlayer(player).map((c) => c.variantId));
  return variantsForAccolade(accolade, player).filter((v) => !before.has(v));
}

/** Construye el núcleo del spec desde el catálogo predicho (el resto lo enriquece el motor). */
export function buildSpecCore(seed: SpecSeed, predicted: CardDef[], season: number): Omit<CardSpec,
  "status" | "releaseState" | "confidence" | "issues" | "badges" | "narrativeTags" | "historicalTags" | "eligibility" | "artwork" | "ruleIds"> | null {
  const card = predicted.find((c) => c.variantId === seed.variantId);
  if (!card) return null; // variante no producida por el catálogo para este jugador
  const variant = getVariant(seed.variantId);
  return {
    cardId: card.id,
    playerId: card.playerId,
    variantId: card.variantId,
    ovr: card.ovr,
    stats: card.stats,
    family: seed.family,
    season,
    series: seriesOf(card.variantId),
    kind: kindForFamily(seed.family),
    rarityBucket: bucketForRank(variant.rank),
    tier: seed.decision.tier,
    serialized: variant.serialized,
    serialLimit: variant.serialLimit,
    decision: seed.decision.action,
    decisionReason: seed.decision.reason,
    estimatedValue: marketValue(card),
  };
}
