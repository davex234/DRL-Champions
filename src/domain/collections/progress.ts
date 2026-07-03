/**
 * DRL COLLECTION ENGINE — progreso (PURO).
 *
 * Calcula obtenidas / faltantes / porcentaje / completada de una colección a
 * partir del conjunto de cardIds que posee el usuario. Generaliza el
 * `collectionProgress` de `src/domain/collections.ts` (regiones).
 */
import type { CollectionDef, CollectionProgress } from "./types";

export function collectionProgress(def: CollectionDef, owned: Set<string>): CollectionProgress {
  const total = def.items.length;
  const missing = def.items.filter((i) => !owned.has(i.cardId)).map((i) => i.cardId);
  const have = total - missing.length;
  return {
    owned: have,
    total,
    pct: total ? Math.round((have / total) * 100) : 0,
    missing,
    complete: total > 0 && missing.length === 0,
  };
}

/** Totales agregados de un conjunto de colecciones. */
export function overallProgress(defs: CollectionDef[], owned: Set<string>) {
  let total = 0, have = 0, completed = 0;
  for (const d of defs) {
    const p = collectionProgress(d, owned);
    total += p.total;
    have += p.owned;
    if (p.complete) completed++;
  }
  return {
    collections: defs.length,
    completed,
    owned: have,
    total,
    pct: total ? Math.round((have / total) * 100) : 0,
  };
}
