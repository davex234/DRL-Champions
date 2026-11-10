/**
 * ARTWORK ASSET MANAGER — tipos (Artwork Pipeline · Fase 1/6).
 *
 * Repositorio OFICIAL de los recursos gráficos de las cartas. SOLO administra assets
 * (identidad, localización, formato, resolución, alias, hash, placeholders): NO genera
 * imágenes, NO compone, NO renderiza, NO toca catálogo/Collection/Packs/Marketplace.
 * Todo puro y determinista; la E/S vive detrás de un lector inyectable (loader.ts).
 */

export const ARTWORK_SCHEMA_VERSION = 1;

/* ── Categorías gestionadas (contrato de la fase) ─────────────────────────── */

export type ArtworkCategory =
  | "player" | "team" | "tournament-logo" | "region" | "country" | "agent" | "map" | "role"
  | "background" | "frame" | "border" | "icon" | "effect" | "font" | "rarity" | "collection" | "badge";

export const ARTWORK_CATEGORIES: readonly ArtworkCategory[] = [
  "player", "team", "tournament-logo", "region", "country", "agent", "map", "role",
  "background", "frame", "border", "icon", "effect", "font", "rarity", "collection", "badge",
] as const;

/* ── Formatos ─────────────────────────────────────────────────────────────── */

export type ArtworkFormat = "png" | "jpg" | "webp" | "svg" | "gif" | "ico" | "woff2" | "ttf" | "css" | "data-svg";

/** Formatos admitidos por categoría (validation.ts los exige). */
export const ALLOWED_FORMATS: Record<ArtworkCategory, readonly ArtworkFormat[]> = {
  player: ["png", "webp", "jpg", "data-svg"],
  team: ["png", "webp", "svg", "data-svg"],
  "tournament-logo": ["png", "webp", "svg", "data-svg"],
  region: ["png", "svg", "data-svg"],
  country: ["png", "svg", "data-svg"],
  agent: ["png", "webp", "svg", "data-svg"],
  map: ["png", "webp", "jpg", "data-svg"],
  role: ["png", "svg", "data-svg"],
  background: ["png", "webp", "jpg", "svg", "css", "data-svg"],
  frame: ["png", "webp", "svg", "css", "data-svg"],
  border: ["png", "svg", "css", "data-svg"],
  icon: ["png", "svg", "ico", "data-svg"],
  effect: ["png", "webp", "gif", "svg", "css", "data-svg"],
  font: ["woff2", "ttf", "css", "data-svg"],
  rarity: ["css", "svg", "data-svg"],
  collection: ["png", "svg", "data-svg"],
  badge: ["png", "svg", "data-svg"],
};

/* ── Asset ────────────────────────────────────────────────────────────────── */

export interface ArtworkAsset {
  /** Identidad única: `<categoría>:<slug>` (p.ej. "team:heretics", "icon:app-192"). */
  id: string;
  category: ArtworkCategory;
  /** Nombre humano. */
  name: string;
  /**
   * Localización: ruta pública ("/teams/heretics.png"), URL remota, `data:` URI
   * (placeholders) o `css:` (recursos definidos por tokens/gradientes del design system).
   */
  path: string;
  format: ArtworkFormat;
  /** Dimensiones DECLARADAS (px). 0 = vectorial/desconocida (svg/css/font). */
  width: number;
  height: number;
  /** Alias de búsqueda (ids alternativos, nombres, tags de resolución). */
  aliases: string[];
  /** Huella determinista del asset (contenido si se cargó; si no, de su declaración). */
  hash: string;
  /** true si es el placeholder oficial de su categoría (nunca cuenta como faltante). */
  placeholder?: boolean;
  /** Sujeto del catálogo al que pertenece (playerId, slug de equipo, ISO de país…). */
  subjectId?: string;
}

/* ── Carga (loader/cache) ─────────────────────────────────────────────────── */

/** Lector de contenido inyectable: ruta → bytes (verifies: fake; app: fetch/fs). */
export type ArtworkReader = (path: string) => Promise<Uint8Array>;

export interface LoadedArtwork {
  asset: ArtworkAsset;
  bytes: number;
  /** Huella del CONTENIDO cargado. */
  contentHash: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  loaded: number;
}

/* ── Resolución ───────────────────────────────────────────────────────────── */

/** Petición de resolución para una carta (ids del catálogo; todo opcional). */
export interface ArtworkRequest {
  playerId?: string;
  teamSlug?: string;
  countryIso?: string;
  tournamentId?: string;
  region?: string;
  agent?: string;
  map?: string;
  role?: string;
  rarity?: string;
  collectionId?: string;
  badges?: string[];
}

/** Un recurso resuelto: asset real o placeholder oficial de la categoría. */
export interface ResolvedArtwork {
  category: ArtworkCategory;
  asset: ArtworkAsset;
  /** true si se sirvió el placeholder (el recurso real falta). */
  isPlaceholder: boolean;
}

/** Resolución completa de la cascada del spec para una carta. */
export interface CardArtworkResolution {
  player: ResolvedArtwork;
  team: ResolvedArtwork;
  country: ResolvedArtwork;
  tournament: ResolvedArtwork;
  background: ResolvedArtwork;
  frame: ResolvedArtwork;
  icons: ResolvedArtwork[];
  effects: ResolvedArtwork[];
  /** Categorías que cayeron a placeholder (informe de faltantes por carta). */
  missing: ArtworkCategory[];
}

/* ── Validación ───────────────────────────────────────────────────────────── */

export interface ArtworkIssue {
  severity: "error" | "warning";
  assetId?: string;
  code: "BAD_ID" | "BAD_FORMAT" | "BAD_DIMENSIONS" | "BAD_PATH" | "DUPLICATE_ID" | "DUPLICATE_ALIAS"
      | "DUPLICATE_HASH" | "BROKEN_REFERENCE" | "MISSING_PLACEHOLDER" | "ORPHAN";
  message: string;
}

export interface ArtworkValidation {
  ok: boolean;
  issues: ArtworkIssue[];
}

/* ── Manifest ─────────────────────────────────────────────────────────────── */

export interface ArtworkManifest {
  schemaVersion: number;
  generatedAt: number;
  total: number;
  byCategory: Record<ArtworkCategory, number>;
  /** Grupos de assets distintos con el MISMO hash. */
  duplicates: { hash: string; assetIds: string[] }[];
  /** Sujetos referenciados sin asset real (cubiertos solo por placeholder). */
  missing: { category: ArtworkCategory; subjectId: string }[];
  /** Assets reales que ninguna referencia usa. */
  orphans: string[];
  /** Alias/refs que apuntan a ids inexistentes. */
  broken: string[];
  /** Huella determinista del manifest completo. */
  fingerprint: string;
}

/** Referencias vivas contra las que el manifest detecta faltantes/huérfanos. */
export interface ArtworkRefs {
  players: string[];
  teams: string[];
  countries: string[];
  tournaments: string[];
  collections: string[];
  badges: string[];
}
