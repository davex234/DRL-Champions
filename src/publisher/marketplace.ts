/**
 * MARKETPLACE APPLIER (Fase 7) — publica el registro de mercado (entradas declarativas por
 * cardId: tradable/valor/restricciones/visibilidad). Nunca crea listados; el MarketEngine
 * (que se construye por operación) leerá el catálogo nuevo automáticamente.
 */
import type { MarketplaceArtifact } from "@/catalog-builder";
import { internal } from "./runtime";

export function applyMarketplaceRuntime(marketplace: MarketplaceArtifact): number {
  const state = internal.state();
  for (const e of marketplace.entries) state.marketEntries.set(e.cardId, e);
  return marketplace.entries.length;
}
