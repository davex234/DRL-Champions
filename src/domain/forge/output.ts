/**
 * F79 · SALIDA DE UNA FORJA — qué pool se sortea y protección contra mala suerte (pity). PURO.
 *
 * Auditoría (F79): la única salida ALEATORIA es el intercambio de cartas (F73) y las recetas avanzadas de salida por
 * CLASE: carta uniforme entre las PUBLICADAS de la clase, con un entero criptográfico del servidor. Lo frustrante que
 * puede pasar es que salga una carta que ya tienes. El pity que lo evitaría («preferir cartas que no posees») cambia el
 * valor esperado de la receta, así que está DESACTIVADO por defecto (`pity.enabled = false`) hasta tener balance
 * aprobado; con él apagado, el pool es exactamente el de F73.
 */
import type { CardDef } from "@/domain/cards/types";
import type { PityConfig } from "./types";

/** El pool efectivo. Con pity activo y `preferUnowned`, las no poseídas (si queda alguna); si no, el pool entero. */
export function effectivePool(pool: readonly CardDef[], owned: ReadonlySet<string>, pity: PityConfig): { pool: CardDef[]; pityApplied: boolean } {
  const all = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  if (!pity.enabled || !pity.preferUnowned) return { pool: all, pityApplied: false };
  const unowned = all.filter((c) => !owned.has(c.id));
  return unowned.length > 0 && unowned.length < all.length ? { pool: unowned, pityApplied: true } : { pool: all, pityApplied: false };
}

/** La carta que sale, dado un entero aleatorio del SERVIDOR en [0, pool.length). */
export function pickFrom(pool: readonly CardDef[], roll: number): CardDef | null {
  if (pool.length === 0 || !Number.isInteger(roll) || roll < 0 || roll >= pool.length) return null;
  return pool[roll];
}
