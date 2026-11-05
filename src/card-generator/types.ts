/**
 * CARD GENERATOR — tipos (Card Generator Fase 4/7).
 *
 * El Card Generator es el ÚNICO motor que decide QUÉ CARTAS EXISTEN. Consume el
 * `AnalyzerResult` (Fase 3) y produce `CardGenerationResult`: decisiones EDITORIALES puras
 * (specs, grants, elegibilidad, estados) — NUNCA materializa: no escribe en Collection, no
 * toca el catálogo, no acuña seriales, no abre sobres. Todo serializable y determinista.
 */
import type { Player, PlayerStats, AccoladeId, VariantId, RarityPalette } from "@/domain/cards/types";
import type { RarityBucket } from "@/domain/packs/types";
import type { CardAction, RarityTier, PlayerHistory } from "@/intel/decide";
import type { NewsItem } from "@/intel/news";
import type { MarketPolicy } from "@/live/market";
import type { ConfidenceLevel } from "@/analyzer";
import type { TournamentType } from "@/engine/types";
import type { CollectionDef } from "@/domain/collections/types";

export const CARD_GENERATOR_SCHEMA_VERSION = 1;

/**
 * Estado de PUBLICACIÓN de la carta en el pipeline (independiente del `releaseState`
 * editorial). F4 emite `generated`/`retired`; `approved`/`published`/`archived` los
 * gestionará la materialización (Fase 5). `planned` = decidida pero aún no generada.
 */
export type CardStatus = "planned" | "generated" | "approved" | "published" | "retired" | "archived";

/** Estado EDITORIAL: draft (jugador nuevo) · pending (requiere aprobación) · approved. */
export type ReleaseState = "draft" | "pending" | "approved";

/* ── Identity ─────────────────────────────────────────────────────────────── */

export type PlayerResolutionStatus = "resolved" | "created" | "ambiguous";

/** Resolución de un jugador del Analyzer (`p:*`) contra el roster del catálogo. */
export interface PlayerResolution {
  analyzerId: string;
  nick: string;
  status: PlayerResolutionStatus;
  /** Id de catálogo (resolved/created). */
  playerId?: string;
  /** Borrador de Player nuevo (solo created) — F5 lo materializará; F4 no escribe. */
  draft?: Player;
  reason: string;
}

/* ── Rule Engine (solo datos, versionado) ─────────────────────────────────── */

export type RuleSource =
  | "award"          // report.awards (kind)
  | "narrativeTag"   // narrativeTags (kind, por equipo)
  | "historicalTag"  // historicalContext.tags (kind)
  | "candidate"      // candidates: kind "mvp" | "allstar"
  | "outlier"        // outliers (kind = métrica, minZ)
  | "highlight"      // candidates.highlights (kind = métrica)
  | "record"         // report.records (kind)
  | "leader"         // argmax de un campo de PlayerReport (kind = campo)
  | "playerReport";  // todos los jugadores con campo (kind) >= minValue

export interface RuleWhen {
  source: RuleSource;
  kind: string;
  minValue?: number;
  minZ?: number;
  /** Puerta de calidad: exige PerformanceConfidence (F3) mínima del jugador. */
  minConfidence?: ConfidenceLevel;
  /** Restringe la regla a ciertos tipos de torneo. */
  tournamentTypes?: TournamentType[];
  /** "roster" = un hecho de EQUIPO concede a todos sus jugadores. */
  teamScope?: "roster";
}

export interface RuleGrant {
  accolade?: AccoladeId;
  badge?: string;
  retire?: boolean;
}

export interface Rule {
  id: string;
  priority: number;
  when: RuleWhen;
  grant: RuleGrant;
}

export interface RuleSet {
  id: string;
  version: number;
  rules: Rule[];
}

/** Concesión de accolade con trazabilidad total (regla + evidencia). Ids del ANALYZER. */
export interface AccoladeGrant {
  playerId: string;
  accolade: AccoladeId;
  ruleId: string;
  evidence: string;
  priority: number;
}

export interface BadgeGrant {
  badge: string;
  ruleId: string;
  evidence: string;
  playerId?: string;
  teamId?: string;
}

/* ── Editorial ────────────────────────────────────────────────────────────── */

export type OverrideKind = "set-mvp" | "grant-accolade" | "block-card" | "force-variant" | "retire-card";

/** Decisión editorial extraordinaria (la ÚNICA intervención manual). Siempre trazada. */
export interface EditorialOverride {
  kind: OverrideKind;
  tournamentId: string;
  /** Id de catálogo del jugador objetivo. */
  playerId: string;
  accolade?: AccoladeId;
  family?: string;
  variantId?: VariantId;
  reason: string;
  author: string;
}

/** Carta decidida pero NO emitida (keep / duplicada / bloqueada) — con su porqué. */
export interface OmittedCard {
  playerId: string;
  family: string;
  action: CardAction | "blocked" | "duplicate";
  reason: string;
}

export interface RetiredCard {
  playerId: string;
  cardId?: string;
  reason: string;
}

/* ── Card Specs ───────────────────────────────────────────────────────────── */

export type CardSpecKind = "mvp" | "champion" | "award" | "exclusive" | "participation" | "base";

/** Referencias de arte (NUNCA imágenes): convención de foto + template por variante + paleta. */
export interface CardArtworkRef {
  image: string;
  photoId?: string;
  templateAssetKey: string;
  palette: RarityPalette;
}

export interface CardEligibility {
  /** Packs reales en los que la carta sería elegible (isEligible × PACKS × política). */
  packs: string[];
  craft: { salvage: boolean; upgradeTargets: string[] };
  market: MarketPolicy;
}

/** Definición editorial COMPLETA de una carta. `stats/ovr` = matemática exacta del catálogo. */
export interface CardSpec {
  cardId: string; // `${playerId}__${variantId}`
  playerId: string;
  variantId: VariantId;
  ovr: number;
  stats: PlayerStats;
  family: string;
  season: number;
  series: string;
  kind: CardSpecKind;
  rarityBucket: RarityBucket;
  tier: RarityTier;
  serialized: boolean;
  serialLimit?: number;
  decision: CardAction;
  decisionReason: string;
  status: CardStatus;
  releaseState: ReleaseState;
  confidence: number;
  issues: string[];
  badges: string[];
  narrativeTags: string[];
  historicalTags: string[];
  eligibility: CardEligibility;
  artwork: CardArtworkRef;
  estimatedValue: number;
  ruleIds: string[];
}

/* ── Ledger / Contexto / Resultado ────────────────────────────────────────── */

/** Estado histórico INYECTADO (anti-reproceso, anti-dup, historial). F4 nunca lo persiste. */
export interface GeneratorLedger {
  processed: string[];
  /** `${playerId}:${family}:${season}` ya emitidas (convención del Live Timeline). */
  cardKeys: string[];
  history: Record<string, PlayerHistory>;
  /** GenerationIds ya usados — NUNCA se reutilizan. */
  generationIds: string[];
}

export const freshLedger = (): GeneratorLedger => ({ processed: [], cardKeys: [], history: {}, generationIds: [] });

export interface GeneratorCtx {
  /** Snapshot del roster del catálogo (inyectado; F4 jamás lee el catálogo vivo). */
  roster: Player[];
  ledger?: GeneratorLedger;
  ruleset?: RuleSet;
  overrides?: EditorialOverride[];
  /** analyzerId (o nick normalizado) → id de catálogo. */
  aliases?: Record<string, string>;
  /** Temporada; si falta se deriva del nombre del torneo (año). */
  season?: number;
  tournamentType?: TournamentType;
  /** playerId de catálogo → photoId aprobado (pipeline de fotos de torneos). */
  photosByPlayer?: Record<string, string>;
  /** Metadatos opcionales para drafts (región/país/imagen) — sin ellos, penaliza confianza. */
  playerMeta?: Record<string, Partial<Pick<Player, "region" | "country" | "image" | "fullName">>>;
  /** Reloj lógico para `generatedAt`/news (nunca Date.now). */
  now?: number;
}

export interface GenerationSummary {
  players: { resolved: number; created: number; ambiguous: number };
  grants: number;
  badges: number;
  cards: number;
  byDecision: Record<string, number>;
  omitted: number;
  approved: number;
  pending: number;
  drafts: number;
  estimatedValueTotal: number;
}

/** Salida FINAL de la Fase 4 — exclusivamente información editorial. */
export interface CardGenerationResult {
  schemaVersion: number;
  /** Identificador ÚNICO de la generación (p.ej. GEN-2025-CHAMPIONS-2025). */
  generationId: string;
  tournamentId: string;
  tournamentName: string;
  season: number;
  generatedAt: number;
  ruleset: { id: string; version: number };
  generator: { version: string; build: number; full: string };
  players: PlayerResolution[];
  grants: AccoladeGrant[];
  badges: BadgeGrant[];
  cards: CardSpec[];
  omitted: OmittedCard[];
  retired: RetiredCard[];
  collection: CollectionDef;
  news: NewsItem[];
  overridesApplied: EditorialOverride[];
  summary: GenerationSummary;
  /** Ledger resultante para encadenar el siguiente torneo (el llamador decide persistirlo). */
  ledgerAfter: GeneratorLedger;
  /** true si el torneo ya estaba procesado (idempotencia: sin cartas, ledger intacto). */
  skipped: boolean;
}
