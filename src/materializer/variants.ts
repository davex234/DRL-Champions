/**
 * VARIANTS (Fase 5) — resolución de variante para materialización: definición REAL de
 * `VARIANTS` (getVariant reutilizado), drop group (bucketForRank reutilizado) y perfil de
 * render derivado del AnimationLevel (datos; el render es de la UI, no de este motor).
 */
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank, type RarityBucket } from "@/domain/packs/types";
import type { VariantDef, VariantId, AnimationLevel } from "@/domain/cards/types";

export interface ResolvedVariant {
  def: VariantDef;
  bucket: RarityBucket;
  renderProfile: AnimationLevel;
}

/** Falla en alto si la variante no existe (una carta con variante desconocida es imposible). */
export function resolveVariant(variantId: VariantId): ResolvedVariant {
  const def = getVariant(variantId);
  if (!def) throw new Error(`Variante desconocida: ${variantId}`);
  return { def, bucket: bucketForRank(def.rank), renderProfile: def.animation };
}
