import type { VariantGroup, VariantId, Region } from "../cards/types";
import type { CardOrigin } from "@/collection/types";

/** Buckets de rareza para las probabilidades de los sobres. */
export type RarityBucket = "common" | "uncommon" | "rare" | "epic" | "legendary";

export const BUCKET_LABEL: Record<RarityBucket, string> = {
  common: "Común",
  uncommon: "Poco común",
  rare: "Rara",
  epic: "Épica",
  legendary: "Legendaria",
};

/** Clasifica una variante (por su rank) en un bucket de rareza. */
export function bucketForRank(rank: number): RarityBucket {
  if (rank <= 2) return "common";
  if (rank <= 5) return "uncommon";
  if (rank <= 8) return "rare";
  if (rank <= 11) return "epic";
  return "legendary";
}

// ───────────────────────────── Collection Fase 2/7 · Pack & Drop Engine ─────────────────────────────
// Campos AÑADIDOS a PackDef, todos OPCIONALES ⇒ los 13 sobres existentes siguen siendo válidos sin
// cambios. El Drop Engine (`src/pack/`) lee esta forma enriquecida; nada se hardcodea, todo son datos.

/** Categoría del sobre (solo semántica/arte + reglas por defecto; no cambia el flujo). */
export type PackKind =
  | "normal" | "premium" | "limited" | "season" | "tournament" | "event"
  | "promo" | "exclusive" | "starter" | "reward" | "mystery";

/** Política ante una carta que el usuario YA posee (el motor decide, no el store). */
export type AntiDupPolicy =
  | "allow"       // permitir duplicados (por defecto)
  | "avoid"       // intentar re-tirar hasta obtener una no poseída (best-effort)
  | "replace"     // si es duplicada, sustituir por otra no poseída del pool
  | "upgrade"     // si es duplicada, subir a una variante superior del mismo jugador si existe
  | "compensate"; // permitir el duplicado pero marcarlo como compensable (evento duplicate)

/** Regla de garantía: al menos N cartas que cumplan el criterio. Generaliza `guaranteedMin`. */
export interface GuaranteeRule {
  count: number;                    // cuántas cartas deben cumplir
  minBucket?: RarityBucket;         // bucket mínimo (>=)
  groups?: VariantGroup[];          // dentro de estos grupos
  serialized?: boolean;             // que sean (o no) serializadas
}

/** Regla de pity (garantía por acumulación de aperturas sin premio). Configurable por sobre. */
export interface PityRule {
  /** Bucket mínimo que garantiza el pity al dispararse. */
  minBucket: RarityBucket;
  /** Nº de cartas/aperturas fallidas tras el cual se fuerza el bucket. */
  threshold: number;
  /** true = cuenta por CARTA sorteada; false = cuenta por APERTURA de sobre. */
  perCard?: boolean;
  /** Clave de contador independiente (permite compartir pity entre sobres de un evento/temporada). */
  counterKey?: string;
}

export interface PackDef {
  id: string;
  name: string;
  description: string;
  /** Precio en DRL Credits. */
  price: number;
  /** Número de cartas que entrega. */
  cardCount: number;
  /** Pesos relativos por bucket para cada carta normal. */
  weights: Record<RarityBucket, number>;
  /**
   * Bucket mínimo garantizado en la última carta (el "tirón"): la última
   * carta se sortea solo entre buckets >= este. Opcional.
   */
  guaranteedMin?: RarityBucket;
  /**
   * Restringe el pool de variantes a estos grupos (p. ej. solo regionales
   * de EMEA). Si se omite, cualquier variante es elegible.
   */
  restrictGroups?: VariantGroup[];
  /** Restringe el pool a una región concreta (sobres regionales). */
  restrictRegion?: "EMEA" | "Americas" | "Pacific" | "China";
  /** Color de acento del sobre (para el arte). */
  accent: string;
  /** Etiqueta corta de categoría (Evento, Premium...). */
  tag?: string;
  /** Si pertenece a un evento: solo disponible mientras el evento esté activo. */
  eventId?: string;

  // ── Capacidades del Drop Engine (todas opcionales) ──
  /** Categoría (por defecto "normal"). Solo semántica. */
  kind?: PackKind;
  /** Origen sellado en cada carta del sobre (por defecto "pack"). */
  origin?: CardOrigin;
  /** Pool explícito de cardIds elegibles. Si se define, IGNORA el escaneo del catálogo. */
  pool?: string[];
  /** Restringe a estas series (prefijos de variantId: masters/champions/ewc/…). */
  series?: string[];
  /** Temporada asociada (metadato/filtrado de sets futuros). */
  season?: string;
  /** Restringe el pool a estas variantes concretas. */
  allowedVariants?: VariantId[];
  /** Excluye estas variantes del pool. */
  excludeVariants?: VariantId[];
  /** Región alternativa (además de `restrictRegion`, para claridad de datos). */
  region?: Region;
  /** Solo variantes serializadas (sobres "limited"/coleccionista). */
  serializedOnly?: boolean;
  /** Reglas de garantía adicionales (además de `guaranteedMin`). */
  guarantees?: GuaranteeRule[];
  /** Regla de pity de este sobre. */
  pity?: PityRule;
  /** Política anti-duplicados (por defecto "allow"). */
  antiDuplicate?: AntiDupPolicy;
  /** Si una misma carta puede salir más de una vez en la MISMA apertura (por defecto true). */
  repeatable?: boolean;
  /** Reglas especiales legibles (documentación/broadcast; no alteran el sorteo). */
  specialRules?: string[];
}
