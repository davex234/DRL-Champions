/**
 * MATERIALIZER — tipos (Card Generator Fase 5/7).
 *
 * El Materializer es el ÚNICO transformador CardGenerationResult → CardDefs + PATCHES
 * incrementales (catálogo/colecciones/packs/craft/mercado). NUNCA decide cartas (eso es F4),
 * NUNCA escribe: emite diffs puros que un aplicador (F6+) ejecutará. Todo serializable,
 * determinista, incremental (jamás reconstruye el catálogo completo).
 */
import type { Player, CardDef, AccoladeId, VariantId, RarityPalette, AnimationLevel } from "@/domain/cards/types";
import type { RarityBucket } from "@/domain/packs/types";
import type { CollectionDef, CollectionItem } from "@/domain/collections/types";
import type { RarityTier, CardAction } from "@/intel/decide";
import type { CardStatus, ReleaseState } from "@/card-generator";

export const MATERIALIZER_SCHEMA_VERSION = 1;

/** Huella SHA-256 (hex) del CardSpec canónico — detección de cambios / cache / incremental. */
export type MaterializationFingerprint = string;

/** Procedencia completa de una materialización (auditoría/rollback/analytics). */
export interface Provenance {
  importerSchema: number;
  analyzerSchema: number;
  generatorSchema: number;
  materializerSchema: number;
  rulesetId: string;
  rulesetVersion: number;
  generationId: string;
  appVersion: string;
  /** Reloj lógico (nunca Date.now). */
  at: number;
}

/** Referencias de arte resueltas (NUNCA imágenes). */
export interface MaterializedArtwork {
  image: string;
  photoId?: string;
  templateAssetKey: string;
  backgroundAssetKey: string;
  palette: RarityPalette;
  /** Perfil de render derivado del AnimationLevel de la variante (datos, no render). */
  renderProfile: AnimationLevel;
}

/** Carta materializada: CardDef definitivo + metadatos editoriales + huella. */
export interface MaterializedCard {
  card: CardDef;
  fingerprint: MaterializationFingerprint;
  family: string;
  season: number;
  series: string;
  tier: RarityTier;
  rarityBucket: RarityBucket;
  decision: CardAction;
  status: CardStatus;
  releaseState: ReleaseState;
  badges: string[];
  narrativeTags: string[];
  historicalTags: string[];
  artwork: MaterializedArtwork;
}

/* ── Patches (SIEMPRE diferencias; nunca rebuild completo) ────────────────── */

export interface CatalogPatch {
  /** Jugadores nuevos (drafts del F4, con sus accolades concedidas ya fusionadas). */
  playersAdd: Player[];
  /** Jugadores existentes: solo las accolades que hay que AÑADIR. */
  playersUpdate: { playerId: string; addAccolades: AccoladeId[] }[];
  cardsAdd: CardDef[];
  /** Cartas cuyo ovr/stats cambian respecto al catálogo actual. */
  cardsUpdate: CardDef[];
  cardsRemove: string[];
  /** Únicos jugadores tocados (prueba de incrementalidad). */
  affectedPlayers: string[];
  /** Siempre false: el Materializer jamás reconstruye el catálogo completo. */
  fullRebuild: false;
}

export interface CollectionPatch {
  add: CollectionDef[];
  update: { collectionId: string; addItems: CollectionItem[] }[];
  season: number;
  /** Series afectadas (masters/champions/ewc/icon/...). */
  series: string[];
}

export interface PackPoolEntry {
  cardId: string;
  /** Drop group del pool (bucket de rareza por rank de variante). */
  bucket: RarityBucket;
}

export interface PackPatch {
  /** Altas de pool por sobre (solo pertenencia; jamás recalcula el sobre). */
  pools: { packId: string; add: PackPoolEntry[] }[];
  /** Caches de pool a invalidar (incluye recrear los engines singleton congelados). */
  invalidate: string[];
}

export interface CraftLink {
  cardId: string;
  /** Recetas EXISTENTES aplicables (por criterios estáticos de variante). */
  recipes: string[];
}

export interface CraftUpgradePath {
  from: string;
  to: string;
  /** Receta existente que realiza el salto. */
  via: string;
}

export interface CraftPatch {
  links: CraftLink[];
  upgradePaths: CraftUpgradePath[];
}

export interface MarketEntry {
  cardId: string;
  tradable: boolean;
  initialValue: number;
  restrictions: { limited: boolean; exclusive: boolean; impossible: boolean };
  visibility: "public" | "unlisted";
}

export interface MarketplacePatch {
  entries: MarketEntry[];
}

/* ── Contexto / resultado ─────────────────────────────────────────────────── */

export type Digest = (bytes: Uint8Array) => Promise<string>;

export interface MaterializerCtx {
  /** Roster ACTUAL del catálogo (snapshot inyectado; jamás se lee el catálogo vivo). */
  roster: Player[];
  /** Catálogo actual; por defecto se deriva del roster (cardsForPlayer reutilizado). */
  existingCards?: CardDef[];
  /** Colecciones actuales (para diff incremental). */
  existingCollections?: { id: string; itemIds: string[] }[];
  /** Huellas ya materializadas (cache): specs sin cambios ⇒ unchanged, sin patch. */
  knownFingerprints?: string[];
  /** SHA-256 inyectable (por defecto `sha256Hex` de platform — Web Crypto). */
  digest?: Digest;
  /** Reloj lógico. */
  now?: number;
}

export interface MaterializationSummary {
  cards: number;
  unchanged: number;
  playersAdded: number;
  playersUpdated: number;
  catalogAdds: number;
  catalogUpdates: number;
  catalogRemovals: number;
  poolEntries: number;
  marketTradable: number;
}

export interface MaterializationResult {
  schemaVersion: number;
  generationId: string;
  provenance: Provenance;
  cards: MaterializedCard[];
  /** cardIds cuyos specs no cambiaron desde la última materialización (cache hit). */
  unchanged: string[];
  catalogPatch: CatalogPatch;
  collectionPatch: CollectionPatch;
  packPatch: PackPatch;
  craftPatch: CraftPatch;
  marketPatch: MarketplacePatch;
  summary: MaterializationSummary;
  /** true si el CardGenerationResult venía skipped (nada que materializar). */
  skipped: boolean;
}
