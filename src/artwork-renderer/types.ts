/**
 * ARTWORK RENDERER — tipos (Artwork Pipeline · Fase 3/6).
 *
 * Motor PASIVO: recibe una ArtworkComposition YA resuelta (Composer, congelado) y solo la
 * materializa en imágenes (PNG · WEBP · thumbnail · preview) + manifest. JAMÁS recalcula
 * capas, JAMÁS decide assets, JAMÁS reordena el render: cualquier composición inválida se
 * rechaza sin tocar disco. Determinista con reloj lógico inyectado.
 */

export const RENDER_VERSION = 1;
export const RENDERER_SCHEMA_VERSION = 1;

/* ── Opciones ─────────────────────────────────────────────────────────────── */

export interface RenderSize { width: number; height: number }

export interface RenderOptions {
  /** Tamaño maestro de carta (proporción 5:7 del lienzo lógico del Composer). */
  card: RenderSize;
  thumbnail: RenderSize;
  preview: RenderSize;
  /** Directorio raíz de salida (crea cards/ · thumbnails/ · previews/ · manifest.json). */
  outputDir: string;
  /** Fecha LÓGICA del render (va al fingerprint/metadata; jamás Date.now aquí). */
  now: number;
  generationId?: string;
}

export const DEFAULT_SIZES = {
  card: { width: 750, height: 1050 },
  thumbnail: { width: 150, height: 210 },
  preview: { width: 375, height: 525 },
} as const;

/* ── Salida ───────────────────────────────────────────────────────────────── */

export type RenderFileKind = "png" | "webp" | "thumbnail" | "preview";

export interface RenderedFile {
  kind: RenderFileKind;
  /** Ruta relativa al outputDir (p.ej. "cards/zekken__mythic.png"). */
  path: string;
  bytes: number;
  /** SHA-256 del fichero (determinismo byte a byte verificable). */
  sha256: string;
  width: number;
  height: number;
}

/** Metadata embebida en CADA imagen (EXIF ImageDescription) y en el manifest. */
export interface RenderMetadata {
  generationId: string;
  cardId: string;
  artworkFingerprint: string;
  renderVersion: number;
  renderedAt: number;
}

export interface RenderedArtwork {
  cardId: string;
  generationId: string;
  /** Huella de la composición (del Composer, intacta). */
  artworkFingerprint: string;
  /** Huella del render (composición + versión + tamaños). Clave de cache/incremental. */
  renderKey: string;
  /** Huella completa embebida (incluye la fecha lógica). */
  renderFingerprint: string;
  metadata: RenderMetadata;
  files: RenderedFile[];
  /** true si NO se re-rasterizó (cache en memoria o render incremental del manifest). */
  fromCache: boolean;
  /** Refs de placeholder usados por la composición (informe; decidido por el Composer). */
  placeholdersUsed: string[];
}

/* ── Manifest ─────────────────────────────────────────────────────────────── */

export interface RenderStats {
  cards: number;
  rendered: number;
  /** Cartas servidas de cache (memoria o incremental). */
  cacheHits: number;
  /** Assets materializados una sola vez y reutilizados entre cartas. */
  assetLoads: number;
  assetReuses: number;
  totalBytes: number;
}

export interface RenderManifest {
  schemaVersion: number;
  renderVersion: number;
  generationId: string;
  renderedAt: number;
  sizes: { card: RenderSize; thumbnail: RenderSize; preview: RenderSize };
  cards: RenderedArtwork[];
  stats: RenderStats;
  /** Huella determinista del manifest (sin tiempos de reloj de pared). */
  fingerprint: string;
}
