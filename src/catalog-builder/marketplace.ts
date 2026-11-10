/**
 * MARKETPLACE (Fase 6) — registro de mercado desde el MarketplacePatch (F5): entradas
 * declarativas (tradable/valor base/restricciones/visibilidad). Jamás crea listados ni toca
 * el MarketEngine.
 */
import type { MaterializationResult } from "@/materializer";
import type { MarketplaceArtifact } from "./types";

export function buildMarketplace(mat: MaterializationResult): MarketplaceArtifact {
  const entries = [...mat.marketPatch.entries].sort((a, b) => a.cardId.localeCompare(b.cardId));
  return {
    entries,
    eligible: entries.filter((e) => e.tradable).length,
    restricted: entries.filter((e) => !e.tradable).length,
  };
}
