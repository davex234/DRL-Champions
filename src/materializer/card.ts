/**
 * CARD BUILDER (Fase 5) — CardSpec → CardDef definitivo + MaterializedCard. El spec YA trae
 * la matemática exacta del catálogo (F4, verificada byte a byte): aquí NO se recalcula nada —
 * se proyecta la definición y se enriquece con variante/arte/huella/metadatos de release.
 */
import type { CardDef } from "@/domain/cards/types";
import type { CardSpec } from "@/card-generator";
import { resolveVariant } from "./variants";
import { resolveMaterializedArtwork } from "./artwork";
import type { MaterializedCard, MaterializationFingerprint } from "./types";

export function buildCardDef(spec: CardSpec): CardDef {
  return { id: spec.cardId, playerId: spec.playerId, variantId: spec.variantId, ovr: spec.ovr, stats: { ...spec.stats } };
}

export function buildMaterializedCard(spec: CardSpec, fingerprint: MaterializationFingerprint): MaterializedCard {
  const v = resolveVariant(spec.variantId);
  return {
    card: buildCardDef(spec),
    fingerprint,
    family: spec.family,
    season: spec.season,
    series: spec.series,
    tier: spec.tier,
    rarityBucket: v.bucket,
    decision: spec.decision,
    status: spec.status,
    releaseState: spec.releaseState,
    badges: spec.badges,
    narrativeTags: spec.narrativeTags,
    historicalTags: spec.historicalTags,
    artwork: resolveMaterializedArtwork(spec),
  };
}
