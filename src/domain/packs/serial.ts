/**
 * SERIAL MINTING (Collection Fase 2/7) — parte interna del dominio de sobres.
 *
 * Calcula el siguiente número de serie REAL (#1, #2, … #N) respetando `serialLimit` de la variante y
 * SIN duplicar: a partir del contador de acuñación ya existente (fuente única = store). Si la variante
 * no es serializada o la tirada está agotada, NUNCA asigna serie. Puro y determinista.
 */
import type { VariantDef } from "../cards/types";

/** Siguiente nº de serie dado el nº ya acuñado (`minted`), o `null` si no procede. */
export function nextSerial(variant: VariantDef, minted: number): number | null {
  if (!variant.serialized || !variant.serialLimit) return null;
  if (minted >= variant.serialLimit) return null; // tirada agotada: no se acuña de más
  return minted + 1;
}
