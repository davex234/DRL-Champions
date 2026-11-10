/**
 * PACK OPENING & DROP ENGINE — vocabulario compartido (Collection Fase 2/7).
 *
 * El Drop Engine es la ÚNICA capa que decide QUÉ carta cae (variante/serie/calidad/origen/eventos).
 * NO posee las cartas, ni el catálogo, ni el inventario: vive ENCIMA del Collection Engine
 * (`@/collection`) y proyecta decisiones. Puro y determinista (RNG del proyecto `@/sim/rng`; sin
 * `Math.random`/`Date.now` — el reloj lógico `now` y la semilla entran por contexto).
 *
 *   Pack → Drop Engine → Collection → Ownership → History → Events → Broadcast → Gameplay/Career/…
 */
import type { CardDef, VariantDef, VariantId } from "@/domain/cards/types";
import type { RarityBucket, PackDef } from "@/domain/packs/types";
import type { CardOrigin, QualityGrade, OwnedCard } from "@/collection/types";
// El estado/persistencia del pity vive en el DOMINIO de sobres (fuente única); aquí se re-exporta.
import type { PityState } from "@/domain/packs/pity";
export { freshPity, PACK_SCHEMA_VERSION } from "@/domain/packs/pity";

export type { CardDef, VariantDef, VariantId, RarityBucket, PackDef, CardOrigin, QualityGrade, OwnedCard, PityState };

/** Una carta ACUÑADA por el Minter (aún sin `uid`/`obtainedAt`: eso lo pone el store en el borde). */
export interface DropInstance {
  cardId: string;
  card: CardDef;
  variantId: VariantId;
  bucket: RarityBucket;
  /** Nº de serie asignado (respeta serialLimit) o null si la variante no es serializada. */
  serial: number | null;
  quality: QualityGrade;
  origin: CardOrigin;
  /** true = primera copia que el usuario obtiene de esta carta. */
  isNew: boolean;
  /** Valor de mercado (reutiliza pricing; sin economía nueva). */
  value: number;
  /** true = esta carta fue forzada por el sistema de pity. */
  byPity: boolean;
  /** true = duplicado marcado como compensable (política anti-dup "compensate"). */
  compensated: boolean;
}

/** Eventos de apertura (superset de Collection Events + específicos del drop). */
export type DropEventType =
  | "pack_opened"
  | "card_obtained"
  | "new_card"
  | "duplicate"
  | "legendary_pull"
  | "signed_pull"
  | "serial_pull"
  | "jackpot"
  | "pity_triggered"
  | "set_completed"
  | "series_completed"
  | "collection_progress"
  | "milestone";

export interface DropEvent {
  type: DropEventType;
  at: number;
  cardId?: string;
  data?: unknown;
}

/** Entrada al motor: estado ACTUAL (leído, nunca mutado) + fuentes de azar/tiempo. */
export interface OpenContext {
  /** Semilla determinista (o RNG ya construido). El motor NUNCA usa Math.random. */
  seed: number;
  /** Propiedad previa (para isNew / anti-dup / eventos de set). La ÚNICA fuente = store. */
  owned: OwnedCard[];
  /** Contador de acuñación por cardId (para nº de serie). La ÚNICA fuente = store. */
  mintCounts: Record<string, number>;
  /** Estado de pity previo. */
  pity: PityState;
  /** Reloj lógico (obtainedAt lo pone el store). */
  now: number;
  /** Fase 41 · asistencia de primer equipo (solo la decide el servidor; ver `openPack`). */
  assist?: import("@/domain/packs/openPack").StarterAssist | null;
}

/** Salida del motor: decisiones + deltas a persistir por el store (nunca persiste el motor). */
export interface OpenResult {
  packId: string;
  instances: DropInstance[];
  events: DropEvent[];
  /** Nuevo estado de pity (el store lo persiste). */
  pityAfter: PityState;
  /** Delta de acuñación: cardId -> nuevo máximo de serie (el store lo funde en mintCounts). */
  mintDelta: Record<string, number>;
}

/** Probabilidades declaradas de un sobre (preview de tienda, sin abrir). */
export interface PackOdds {
  packId: string;
  cardCount: number;
  poolSize: number;
  /** % por bucket (normalizado sobre buckets con stock). */
  byBucket: Record<RarityBucket, number>;
  guaranteedMin: RarityBucket | null;
  hasPity: boolean;
  antiDuplicate: string;
  /**
   * Fase 57.3 · cómo decide el sobre. En `class-distribution` manda `byClass` (tabla de `packClass`, en %) y `byBucket`
   * va a cero: la rareza no gobierna ese producto y no se enseña como si lo hiciera.
   */
  drawMode: "class-distribution" | "rarity-weights";
  byClass: Record<string, number> | null;
}

/** Resultado de validar un PackDef contra el registro (SEGURIDAD). */
export interface PackIssue { packId: string; reason: string }
export interface PackValidation { ok: boolean; issues: PackIssue[] }
