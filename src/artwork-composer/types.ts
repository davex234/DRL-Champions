/**
 * ARTWORK COMPOSER — tipos (Artwork Pipeline · Fase 2/6).
 *
 * El equivalente VISUAL del Card Generator: CardSpec → ArtworkComposition. La composición
 * describe EXACTAMENTE cómo se construye una carta usando SOLO referencias (ids de assets
 * del Artwork Asset Manager, tokens y coordenadas fraccionales): jamás imágenes, jamás
 * Canvas, jamás HTML, jamás píxeles renderizados. Será la ÚNICA entrada del futuro
 * Artwork Renderer (fase posterior; hoy no existe ningún renderizado).
 */
import type { ArtworkCategory } from "@/artwork";
import type { RarityPalette } from "@/domain/cards/types";

export const COMPOSER_SCHEMA_VERSION = 1;

/* ── Orden OFICIAL de capas (contrato; nunca duplicadas) ──────────────────── */

export type LayerKind =
  | "background" | "background-effects" | "tournament" | "team" | "player" | "frame"
  | "badges" | "icons" | "texts" | "foreground-effects" | "overlay" | "debug";

export const LAYER_ORDER: readonly LayerKind[] = [
  "background", "background-effects", "tournament", "team", "player", "frame",
  "badges", "icons", "texts", "foreground-effects", "overlay", "debug",
] as const;

/* ── Layout (declarativo: fracciones 0..1 del lienzo lógico, nunca píxeles) ── */

export type Anchor =
  | "center" | "top" | "bottom" | "left" | "right"
  | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type Alignment = "left" | "center" | "right";

export interface ElementLayout {
  /** Posición fraccional del punto de anclaje (0..1 sobre el lienzo lógico). */
  x: number;
  y: number;
  anchor: Anchor;
  /** Escala relativa (1 = tamaño natural del slot). */
  scale: number;
  /** Rotación en grados. */
  rotation: number;
  /** Prioridad dentro de su capa (mayor = después). */
  priority: number;
  align: Alignment;
  /** Profundidad global (índice de capa × 100 + prioridad). */
  depth: number;
  /** Opacidad 0..1. */
  opacity: number;
}

/* ── Elementos ────────────────────────────────────────────────────────────── */

export type EffectKind =
  | "glow" | "foil" | "holographic" | "shadow" | "fire" | "smoke" | "lightning" | "particles" | "aura";

export type BadgeKind =
  | "mvp" | "champion" | "champion-edition" | "elite" | "legend" | "regional"
  | "rookie" | "collector" | "special-event" | "perfect-tournament" | "record-holder";

export const BADGE_KINDS: readonly BadgeKind[] = [
  "mvp", "champion", "champion-edition", "elite", "legend", "regional",
  "rookie", "collector", "special-event", "perfect-tournament", "record-holder",
] as const;

export type TextRole =
  | "player-name" | "ovr" | "rarity" | "collection" | "edition" | "tournament" | "season" | "badge-label" | "debug";

export type ElementType = "asset" | "text" | "effect" | "badge";

export interface TextSpec {
  role: TextRole;
  content: string;
  /** Referencia a la fuente del Asset Manager (jamás la fuente en sí). */
  fontRef: string;
  /** Tamaño fraccional respecto a la altura del lienzo lógico. */
  size: number;
  /** Token de color de la paleta ("palette.primary" | "palette.text" | …). */
  colorToken: string;
}

export interface ComposedElement {
  /** Id ÚNICO en toda la composición: `<capa>:<rol>`. */
  id: string;
  type: ElementType;
  /** Referencia a un asset del Artwork Asset Manager (asset.id). Nunca una imagen. */
  ref: string;
  category: ArtworkCategory;
  /** true si el recurso real falta y se referencia el placeholder oficial. */
  isPlaceholder: boolean;
  layout: ElementLayout;
  text?: TextSpec;
  effect?: EffectKind;
  badge?: BadgeKind;
}

export interface CompositionLayer {
  kind: LayerKind;
  elements: ComposedElement[];
}

/* ── Composición ──────────────────────────────────────────────────────────── */

export interface ArtworkComposition {
  schemaVersion: number;
  cardId: string;
  playerId: string;
  variantId: string;
  generationId?: string;
  /** Lienzo LÓGICO: proporción + unidad fraccional. Sin píxeles renderizados. */
  canvas: { aspectRatio: number; unit: "fraction" };
  /** Paleta de la rareza (tokens de color; viene del CardSpec, nunca recalculada). */
  palette: RarityPalette;
  /** SIEMPRE las 12 capas oficiales, en LAYER_ORDER, sin duplicados. */
  layers: CompositionLayer[];
  /** Refs de assets REALES usados (únicos, ordenados). */
  assetsUsed: string[];
  /** Refs de PLACEHOLDERS usados (únicos, ordenados). */
  placeholdersUsed: string[];
  /** Categorías cuyo recurso real falta. */
  missingCategories: ArtworkCategory[];
  metadata: {
    rarity: string;
    tier: string | number;
    kind: string;
    season: number;
    series: string;
    family: string;
    ovr: number;
    serialized: boolean;
    serialLimit?: number;
    badges: BadgeKind[];
    effects: EffectKind[];
  };
  /** Huella determinista de toda la composición. */
  fingerprint: string;
}

/* ── Contexto del composer ────────────────────────────────────────────────── */

export interface ComposerCtx {
  /** Nick visible del jugador (CardSpec solo lleva playerId). */
  nick?: string;
  teamSlug?: string;
  countryIso?: string;
  tournamentId?: string;
  tournamentName?: string;
  generationId?: string;
  collectionId?: string;
  collectionName?: string;
  region?: string;
  role?: string;
  agent?: string;
  map?: string;
  /** Añade la capa de debug (id de carta + huella). */
  debug?: boolean;
}

export interface CompositionIssue {
  code: "DUPLICATE_LAYER" | "MISSING_LAYER" | "BAD_LAYER_ORDER" | "DUPLICATE_ELEMENT_ID"
      | "EMPTY_REF" | "BAD_LAYOUT" | "FORBIDDEN_CONTENT";
  message: string;
}

export interface CompositionValidation {
  ok: boolean;
  issues: CompositionIssue[];
}
