/**
 * REVIEW MODEL BUILDER — `buildReviewModel(src)`: una fila por carta de la generación,
 * cruzando las salidas EXISTENTES del pipeline (specs F4 + catálogo/colecciones/mercado F6 +
 * transacción F7). Puro, determinista y serializable: no lee el catálogo vivo ni los stores.
 */
import type { CardGenerationResult } from "@/card-generator";
import type { CatalogBuildResult } from "@/catalog-builder";
import type { PublishResult } from "@/publisher";
import type { ReviewCardRow, ReviewModel } from "./types";

export const REVIEW_SCHEMA_VERSION = 1;

export interface ReviewSource {
  generation: CardGenerationResult;
  build: CatalogBuildResult;
  publish: PublishResult;
  /** Nombre visible del torneo (por defecto, el de la generación). */
  tournamentName?: string;
}

export function buildReviewModel(src: ReviewSource): ReviewModel {
  const { generation: gen, build, publish } = src;
  const tournamentName = src.tournamentName ?? gen.tournamentName;

  const playerById = new Map(build.catalog.players.map((p) => [p.id, p]));
  const marketByCard = new Map(build.marketplace.entries.map((e) => [e.cardId, e]));
  const collectionsByCard = new Map<string, { id: string; name: string }[]>();
  for (const col of build.collections.collections) {
    for (const item of col.items) {
      const list = collectionsByCard.get(item.cardId) ?? [];
      list.push({ id: col.id, name: col.name });
      collectionsByCard.set(item.cardId, list);
    }
  }
  const grantsByPlayer = new Map<string, { ruleId: string; evidence: string }[]>();
  for (const g of gen.grants) {
    const list = grantsByPlayer.get(g.playerId) ?? [];
    list.push({ ruleId: g.ruleId, evidence: g.evidence });
    grantsByPlayer.set(g.playerId, list);
  }

  const rows: ReviewCardRow[] = gen.cards.map((spec) => {
    const player = playerById.get(spec.playerId);
    const market = marketByCard.get(spec.cardId);
    const grants = grantsByPlayer.get(spec.playerId) ?? [];
    // Evidencia: los grants del jugador cuya regla participó en esta carta; si ninguna regla
    // coincide (p. ej. carta base), queda la razón editorial de la decisión.
    const evidence = grants.filter((g) => spec.ruleIds.includes(g.ruleId)).map((g) => g.evidence);
    return {
      cardId: spec.cardId,
      playerId: spec.playerId,
      player: player?.nick ?? spec.playerId,
      team: player?.team ?? "—",
      tournamentId: gen.tournamentId,
      tournamentName,
      season: spec.season,
      variantId: spec.variantId,
      ovr: spec.ovr,
      rarityBucket: spec.rarityBucket,
      tier: spec.tier,
      serialized: spec.serialized,
      serialLimit: spec.serialLimit,
      badges: spec.badges,
      collections: collectionsByCard.get(spec.cardId) ?? [],
      packs: spec.eligibility.packs,
      market: {
        tradable: market?.tradable ?? spec.eligibility.market.toMarket,
        initialValue: market?.initialValue ?? spec.estimatedValue,
        visibility: market?.visibility ?? "public",
      },
      status: spec.status,
      releaseState: spec.releaseState,
      decision: spec.decision,
      decisionReason: spec.decisionReason,
      confidence: spec.confidence,
      rules: spec.ruleIds,
      evidence,
      artwork: { image: spec.artwork.image, hasCustom: !!spec.artwork.photoId },
      generationId: gen.generationId,
      generatedAt: gen.generatedAt,
    };
  });

  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    generationId: gen.generationId,
    tournamentId: gen.tournamentId,
    tournamentName,
    season: gen.season,
    catalogVersion: build.catalogVersion,
    catalogFingerprint: build.catalogFingerprint,
    runtimeVersion: publish.runtimeVersion,
    applied: publish.applied,
    publishedAt: gen.generatedAt,
    counts: {
      cards: rows.length,
      players: new Set(rows.map((r) => r.playerId)).size,
      collections: build.collections.collections.length,
      packsEligible: rows.filter((r) => r.packs.length > 0).length,
      marketEligible: rows.filter((r) => r.market.tradable).length,
    },
    rows,
  };
}
