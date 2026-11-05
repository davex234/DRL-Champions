/**
 * CATALOG BUILDER — tipos (Card Generator Fase 6/7).
 *
 * El Catalog Builder es el ÚNICO transformador MaterializationResult → CatalogBuildResult:
 * catálogo lógico reconstruido INCREMENTALMENTE + índices + colecciones + pools + craft +
 * mercado + búsqueda + noticias + manifiesto + estadísticas + diff + validación. Nunca decide
 * cartas, nunca escribe en disco/stores, nunca publica. Todo serializable y determinista.
 */
import type { Player, CardDef } from "@/domain/cards/types";
import type { RarityBucket } from "@/domain/packs/types";
import type { CollectionDef } from "@/domain/collections/types";
import type { SetDef } from "@/collection/types";
import type { NewsItem } from "@/intel/news";
import type { Digest, MarketEntry, CraftLink, CraftUpgradePath } from "@/materializer";

export const CATALOG_BUILDER_SCHEMA_VERSION = 1;

/** Versión SEMÁNTICA del catálogo: `<temporada>.<minor>.<patch>` (p.ej. "2026.3.0"). */
export type CatalogVersion = string;

/** SHA-256 (hex) sobre TODO el catálogo generado — cache/rollback/comparación/publicación. */
export type CatalogFingerprint = string;

/* ── Artefactos ───────────────────────────────────────────────────────────── */

export interface CatalogArtifact {
  players: Player[];
  cards: CardDef[];
}

export interface CatalogIndexes {
  byPlayer: Record<string, string[]>;
  byTeam: Record<string, string[]>;
  byRegion: Record<string, string[]>;
  byVariant: Record<string, string[]>;
  byGroup: Record<string, string[]>;
  byRarity: Record<RarityBucket, string[]>;
  /** Solo cartas con procedencia conocida (materializadas en esta u otras generaciones). */
  bySeason: Record<string, string[]>;
  byFamily: Record<string, string[]>;
  byCollection: Record<string, string[]>;
  byPack: Record<string, string[]>;
  byMarket: { tradable: string[]; restricted: string[] };
  byCraft: Record<string, string[]>;
  /** Sets/series/temporadas derivados (CardRegistry.allSets reutilizado). */
  sets: SetDef[];
}

export interface CollectionsArtifact {
  collections: CollectionDef[];
  /** Totales por colección (la completion real depende de propiedad = runtime). */
  completion: { collectionId: string; total: number }[];
  /** Álbum: orden determinista de items por colección. */
  album: { collectionId: string; cardIds: string[] }[];
  /** Museo: escaparate de cartas serializadas/exclusivas. */
  museum: string[];
  series: Record<string, string[]>;
}

export interface PackPoolArtifact {
  packId: string;
  size: number;
  buckets: Record<RarityBucket, number>;
  /** Altas de esta generación (del PackPatch). */
  added: string[];
  /** Metadatos de odds: peso normalizado por bucket NO vacío (datos del PackDef). */
  odds: Record<RarityBucket, number>;
}

export interface PacksArtifact {
  pools: PackPoolArtifact[];
  invalidated: string[];
}

export interface CraftArtifact {
  /** Recetas EXISTENTES (ids del catálogo de datos; jamás se crean). */
  recipes: string[];
  links: CraftLink[];
  upgradeGraph: CraftUpgradePath[];
  evolutionGraph: CraftUpgradePath[];
  /** Dependencias económicas por receta (referencia, sin recalcular economía). */
  dependencies: { recipeId: string; credits?: number; materials?: Record<string, number> }[];
}

export interface MarketplaceArtifact {
  entries: MarketEntry[];
  eligible: number;
  restricted: number;
}

export type SearchRowKind = "card" | "player" | "team" | "collection" | "season" | "variant";

export interface SearchArtifact {
  rows: { kind: SearchRowKind; ref: string; hay: string }[];
}

export interface CatalogManifest {
  catalogVersion: CatalogVersion;
  catalogFingerprint: CatalogFingerprint;
  generationId: string;
  materializationFingerprints: string[];
  counts: {
    players: number; cards: number; collections: number; packs: number;
    craftLinks: number; marketEntries: number; searchRows: number; news: number;
  };
  /** SHA-256 por sección (comparación/publicación incremental). */
  hashes: Record<string, string>;
  dependencies: {
    importerSchema: number; analyzerSchema: number; generatorSchema: number;
    materializerSchema: number; catalogBuilderSchema: number; appVersion: string;
  };
  at: number;
}

export interface CatalogStatistics {
  totalCards: number;
  totalPlayers: number;
  newCards: number;
  updatedCards: number;
  retiredCards: number;
  collections: number;
  packsWithChanges: number;
  craftRecipes: number;
  marketplaceEligible: number;
  searchEntries: number;
  generation: { generationId: string; unchanged: number; season: number };
}

export interface CatalogDiff {
  added: string[];
  updated: string[];
  removed: string[];
  /** Cartas preexistentes cuya pertenencia (pool/colección) cambió. */
  moved: string[];
  retired: string[];
  /** Cambios solo de metadatos (mercado/visibilidad). */
  changed: string[];
}

export interface ValidationIssue {
  severity: "error" | "warning";
  section: string;
  message: string;
}

export interface CatalogValidation {
  ok: boolean;
  issues: ValidationIssue[];
}

/* ── Contexto / resultado ─────────────────────────────────────────────────── */

export interface CatalogBuilderCtx {
  /** Roster ACTUAL (snapshot inyectado; jamás se lee el catálogo vivo). */
  roster: Player[];
  /** Catálogo actual (por defecto derivado del roster). */
  existingCards?: CardDef[];
  existingCollections?: CollectionDef[];
  /** Versión anterior del catálogo (para el bump semántico). */
  previousVersion?: CatalogVersion;
  /** Procedencia por carta de builds anteriores (season/family), para índices incrementales. */
  knownProvenance?: { cardId: string; season: number; family: string }[];
  digest?: Digest;
  now?: number;
}

export interface CatalogBuildResult {
  schemaVersion: number;
  catalogVersion: CatalogVersion;
  catalogFingerprint: CatalogFingerprint;
  generationId: string;
  manifest: CatalogManifest;
  catalog: CatalogArtifact;
  indexes: CatalogIndexes;
  collections: CollectionsArtifact;
  packs: PacksArtifact;
  craft: CraftArtifact;
  marketplace: MarketplaceArtifact;
  search: SearchArtifact;
  news: NewsItem[];
  stats: CatalogStatistics;
  diff: CatalogDiff;
  validation: CatalogValidation;
  unchanged: string[];
  skipped: boolean;
}
