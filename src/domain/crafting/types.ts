/**
 * F73 · CRAFTEO — vocabulario. PURO.
 *
 * Dos recetas, dos sistemas:
 *   · PACK — entregas N sobres de una categoría y recibes 1 sobre de la superior (va a «sin abrir», no se abre solo).
 *   · CARD — INTERCAMBIO: entregas N cartas (duplicados) de una clase y recibes 1 carta ALEATORIA de la clase superior.
 * Los PROYECTOS de carta (misiones → carta concreta) son otra cosa y viven en `domain/missionEngine`.
 *
 * Las clases de carta son las canónicas de `packCardClass` (edición + OVR), nunca un color.
 */
import type { PackCardClass } from "@/domain/packs/packClass";

export type RecipeKind = "PACK" | "CARD";
export type RecipeStatus = "ACTIVE" | "DISABLED" | "RETIRED";
export const RECIPE_STATUSES: readonly RecipeStatus[] = ["ACTIVE", "DISABLED", "RETIRED"];

export interface CraftRecipe {
  id: string;
  kind: RecipeKind;
  name: string;
  /** PACK: sobre de entrada y de salida. */
  inputPackId: string | null;
  outputPackId: string | null;
  /** CARD: clase de entrada y de salida. */
  inputClass: PackCardClass | null;
  outputClass: PackCardClass | null;
  /** Cuántas unidades se entregan (≥ 2). La salida es siempre 1. */
  inputQty: number;
  status: RecipeStatus;
  sortOrder: number;
  availableFrom: number | null;
  availableTo: number | null;
  version: number;
}

/** ¿Está disponible AHORA (reloj del servidor)? */
export function recipeLive(r: Pick<CraftRecipe, "status" | "availableFrom" | "availableTo">, now: number): boolean {
  if (r.status !== "ACTIVE") return false;
  if (r.availableFrom !== null && now < r.availableFrom) return false;
  if (r.availableTo !== null && now >= r.availableTo) return false;
  return true;
}

export const RECIPE_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
