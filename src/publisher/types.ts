/**
 * PUBLISHER — tipos (Card Generator Fase 7/7, FINAL).
 *
 * El Publishing Pipeline es el ÚNICO módulo autorizado a aplicar un `CatalogBuildResult` al
 * RUNTIME (catálogo vivo + engines + caches + búsqueda + colecciones + noticias). Hasta F6
 * todo era puro; aquí vive el primer efecto secundario CONTROLADO: transaccional, validado,
 * con rollback exacto por CatalogFingerprint/GenerationId. No genera cartas, no recalcula
 * nada, no introduce reglas editoriales.
 */
import type { Player, CardDef } from "@/domain/cards/types";
import type { CollectionDef } from "@/domain/collections/types";
import type { NewsItem } from "@/intel/news";
import type { MarketEntry } from "@/materializer";
import type { CatalogBuildResult, CatalogManifest, CatalogVersion, CatalogFingerprint, SearchArtifact } from "@/catalog-builder";

export const PUBLISHER_SCHEMA_VERSION = 1;

/** Versión del RUNTIME (contador monótono de publicaciones/rollbacks) — separada de CatalogVersion. */
export type RuntimeVersion = number;

export type TransactionState = "PREPARING" | "VALIDATING" | "PUBLISHING" | "COMPLETED" | "ROLLED_BACK" | "FAILED";

/** Transacción de publicación: trazabilidad completa del ciclo de estados. */
export interface PublishTransaction {
  id: string; // `tx:<generationId>:<runtimeVersion destino>`
  kind: "publish" | "rollback";
  generationId: string;
  states: { state: TransactionState; at: number }[];
  finalState: TransactionState;
}

/** Instantánea EXACTA de una publicación (para rollback sin reconstrucción manual). */
export interface RuntimeSnapshot {
  runtimeVersion: RuntimeVersion;
  catalogVersion: CatalogVersion;
  catalogFingerprint: CatalogFingerprint;
  generationId: string;
  players: Player[];
  cards: CardDef[];
  collections: CollectionDef[];
  search: SearchArtifact;
  marketEntries: MarketEntry[];
  news: NewsItem[];
  manifest?: CatalogManifest;
}

export interface RuntimeValidationIssue {
  severity: "error" | "warning";
  section: string;
  message: string;
}

export interface RuntimeValidation {
  ok: boolean;
  issues: RuntimeValidationIssue[];
}

export interface PublishMetrics {
  /** Tiempo real de aplicación (informativo; excluido de las comparaciones de determinismo). */
  durationMs: number;
  newCards: number;
  updatedCards: number;
  retiredCards: number;
  catalogFingerprint: CatalogFingerprint;
  materializationFingerprints: number;
  sectionHashes: number;
  runtimeVersion: RuntimeVersion;
  poolsRefreshed: number;
  newsPublished: number;
}

export interface PublishCtx {
  /** Reloj lógico para la transacción (nunca Date.now). */
  now?: number;
  /**
   * Persistencia opcional del roster resultante (p.ej. useRosterStore en la app). El publisher
   * aplica SIEMPRE al catálogo vivo; el llamador decide si además persiste.
   */
  persist?: (players: Player[]) => void;
}

export interface PublishResult {
  schemaVersion: number;
  ok: boolean;
  /** false = no-op (build skipped / fingerprint ya publicado): idempotencia. */
  applied: boolean;
  transaction: PublishTransaction;
  runtimeVersion: RuntimeVersion;
  catalogVersion: CatalogVersion;
  catalogFingerprint: CatalogFingerprint;
  generationId: string;
  validation: RuntimeValidation;
  metrics: PublishMetrics;
  /** Presente si un fallo forzó rollback automático al estado anterior. */
  rolledBackTo?: { runtimeVersion: RuntimeVersion; catalogFingerprint: CatalogFingerprint };
}

export type RollbackTarget = { generationId: string } | { catalogFingerprint: CatalogFingerprint };

/** Decisiones de invalidación incremental del Cache Manager. */
export interface CacheInvalidation {
  /** true = la build ya está publicada (mismo CatalogFingerprint) ⇒ no-op. */
  alreadyPublished: boolean;
  /** Huellas de materialización nuevas respecto a lo cacheado. */
  newFingerprints: string[];
  /** Pools de packs a refrescar (del PackPatch/artefacto). */
  pools: string[];
  refreshSearch: boolean;
  refreshCollections: boolean;
  refreshMarket: boolean;
  refreshNews: boolean;
}

/** Build mínima aceptada por publish() (el CatalogBuildResult completo de F6). */
export type PublishableBuild = CatalogBuildResult;
