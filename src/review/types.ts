/**
 * CARD REVIEW — tipos (Tournament Automation · Fase 3/5).
 *
 * Proyección de SOLO LECTURA de la última generación publicada (F4→F7) para el Review
 * Dashboard (/admin/card-review). No es un motor: no decide, no muta, no persiste catálogo —
 * únicamente reorganiza salidas EXISTENTES (CardGenerationResult + CatalogBuildResult +
 * PublishResult) en filas visualizables, filtrables y ordenables.
 */
import type { RarityBucket } from "@/domain/packs/types";
import type { CardStatus, ReleaseState } from "@/card-generator";

export interface ReviewCardRow {
  cardId: string;
  playerId: string;
  /** Nick visible del jugador. */
  player: string;
  team: string;
  tournamentId: string;
  tournamentName: string;
  season: number;
  variantId: string;
  ovr: number;
  rarityBucket: RarityBucket;
  tier: string;
  serialized: boolean;
  serialLimit?: number;
  badges: string[];
  /** Colecciones del catálogo publicado que contienen la carta. */
  collections: { id: string; name: string }[];
  /** Packs reales en los que la carta es elegible (política del F4). */
  packs: string[];
  market: { tradable: boolean; initialValue: number; visibility: string };
  status: CardStatus;
  releaseState: ReleaseState;
  decision: string;
  decisionReason: string;
  confidence: number;
  /** Reglas (ruleIds) que generaron la carta. */
  rules: string[];
  /** Evidencia objetiva de los grants que la sustentan. */
  evidence: string[];
  artwork: { image: string; hasCustom: boolean };
  generationId: string;
  generatedAt: number;
}

export interface ReviewModel {
  schemaVersion: number;
  generationId: string;
  tournamentId: string;
  tournamentName: string;
  season: number;
  catalogVersion: string;
  catalogFingerprint: string;
  runtimeVersion: number;
  /** true si la publicación llegó a aplicarse al runtime (no fue no-op ni falló). */
  applied: boolean;
  publishedAt: number;
  counts: { cards: number; players: number; collections: number; packsEligible: number; marketEligible: number };
  rows: ReviewCardRow[];
}

/** Filtros del dashboard: valores EXACTOS de las facetas (sin texto libre). */
export interface ReviewFilter {
  team?: string;
  player?: string;
  rarity?: RarityBucket;
  collection?: string;
  tournament?: string;
  status?: CardStatus;
  variant?: string;
}

export type ReviewSortKey = "ovr" | "rarity" | "player" | "date";

/** Valores distintos disponibles por faceta (alimenta los selects del dashboard). */
export interface ReviewFacets {
  teams: string[];
  players: string[];
  rarities: RarityBucket[];
  collections: { id: string; name: string }[];
  tournaments: string[];
  statuses: CardStatus[];
  variants: string[];
}
