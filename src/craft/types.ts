/**
 * CRAFTING, EVOLUTION & UPGRADE ENGINE — vocabulario compartido (Collection Fase 4/7).
 *
 * El Craft Engine EVOLUCIONA cartas: no crea otra carta/catálogo/inventario/economía. Vive ENCIMA del
 * Collection Engine y del Pack Minter (fuente única de acuñación) y devuelve un PLAN puro que el store
 * aplica. La IDENTIDAD de la carta (jugador) se mantiene: solo cambia su variante hacia una que YA
 * EXISTE en el catálogo (nunca inventa una carta). El ÚNICO recurso nuevo son los "materiales" (polvo
 * por rareza), reutilizando `RarityBucket`. Determinista (RNG del proyecto; reloj lógico inyectado).
 *
 *   Collection → Craft Engine → Collection → Deck → Gameplay → Career → Marketplace
 */
import type { CardDef, VariantId, VariantGroup } from "@/domain/cards/types";
import type { RarityBucket } from "@/domain/packs/types";
import type { CardOrigin, OwnedCard } from "@/collection";
import type { DropInstance } from "@/pack";

export type { CardDef, VariantId, VariantGroup, RarityBucket, CardOrigin, OwnedCard, DropInstance };

/** Versión del estado persistible de materiales/recetas (migraciones/compat futura). */
export const CRAFT_SCHEMA_VERSION = 1;

/** Materiales = polvo por bucket de rareza. ÚNICO recurso nuevo (reutiliza RarityBucket). */
export type Materials = Record<RarityBucket, number>;

// ───────────────────────────── Recetas (todo por datos, nada hardcodeado) ─────────────────────────────

export type RecipeKind = "craft" | "upgrade" | "evolution" | "fusion" | "salvage" | "reforge" | "promotion";

/** Criterio de las cartas de ENTRADA (consumidas). Todos AND; arrays OR internos. */
export interface InputMatch {
  /** Nº de instancias consumidas (0 = craft solo con materiales). */
  count: number;
  minBucket?: RarityBucket;
  maxBucket?: RarityBucket;
  groups?: VariantGroup[];
  variants?: VariantId[];
  serialized?: boolean;
  /** Todas las entradas deben ser del MISMO jugador (fusión/upgrade). */
  samePlayer?: boolean;
  /** Solo cartas con >1 copia poseída (duplicados). */
  duplicatesOnly?: boolean;
  /** Permite consumir cartas bloqueadas (por defecto NO). */
  allowLocked?: boolean;
}

/** Cómo se resuelve la SALIDA (declarativo, sin ifs por rareza). */
export type OutputMode = "explicit" | "variant" | "nextRank" | "group" | "materials";

export interface OutputSpec {
  mode: OutputMode;
  /** explicit: un cardId concreto (debe existir). */
  cardId?: string;
  /** variant: misma identidad (jugador) + esta variante (debe existir para ese jugador). */
  variant?: VariantId;
  /** group: la variante de menor rango de ese grupo para el jugador (rango > entrada). */
  group?: VariantGroup;
  /** materials (salvage): polvo del bucket de cada entrada. */
  dustByBucket?: boolean;
  /** materials (salvage): polvo fijo por entrada. */
  materials?: Partial<Materials>;
  /** materials (salvage): créditos por entrada (reutiliza pricing si se omite y valueFromCard). */
  credits?: number;
  /** materials (salvage): calcular créditos con la liquidación canónica (`salvageValue`, F57.6). */
  valueFromCard?: boolean;
}

export interface RecipeCost {
  materials?: Partial<Materials>;
  credits?: number;
}

export interface Recipe {
  id: string;
  name: string;
  description?: string;
  kind: RecipeKind;
  input: InputMatch;
  output: OutputSpec;
  cost?: RecipeCost;
  version?: number;
}

// ───────────────────────────── Contexto / resultado (plan puro) ─────────────────────────────

/** Estado ACTUAL (leído, nunca mutado) + azar/tiempo. La propiedad/moneda son fuente única = store. */
export interface CraftContext {
  owned: OwnedCard[];
  materials: Materials;
  credits: number;
  mintCounts: Record<string, number>;
  /** uids bloqueados (anti-salvage). SOLO LECTURA. */
  locks: Set<string>;
  /** uids concretos elegidos por el usuario (opcional; si no, selección automática determinista). */
  selection?: string[];
  seed: number;
  now: number;
}

export type CraftIssueCode =
  | "INVALID_RECIPE" | "NOT_ENOUGH_INPUTS" | "INSUFFICIENT_MATERIALS" | "INSUFFICIENT_CREDITS"
  | "LOCKED_CARD" | "CARD_NOT_FOUND" | "OUTPUT_NOT_IN_CATALOG"
  | "NOT_SAME_PLAYER" | "SELECTION_MISMATCH";

export interface CraftIssue { code: CraftIssueCode; message: string }

export type CraftEventType =
  | "crafted" | "upgraded" | "evolved" | "fused" | "salvaged" | "reforged" | "promoted"
  | "duplicate_used" | "materials_spent" | "materials_gained" | "card_obtained" | "new_card";

export interface CraftEvent { type: CraftEventType; at: number; cardId?: string; uid?: string; data?: unknown }

/** PLAN puro del resultado (el store lo aplica: quita entradas, acuña salidas, mueve materiales/moneda). */
export interface CraftResult {
  ok: boolean;
  recipeId: string;
  kind: RecipeKind;
  issues: CraftIssue[];
  /** uids de instancias consumidas (a eliminar). */
  removedUids: string[];
  /** salidas acuñadas por el Pack Minter (fuente única). */
  instances: DropInstance[];
  /** delta de acuñación de serie (cardId → nuevo máximo). */
  mintDelta: Record<string, number>;
  materialsAfter: Materials;
  creditsAfter: number;
  events: CraftEvent[];
}

/** Resultado de validar una receta contra el registro (SEGURIDAD, sin ejecutar). */
export interface RecipeValidation { ok: boolean; issues: CraftIssue[] }
