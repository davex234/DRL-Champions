/**
 * STATISTICS (Fase 6) — métricas de la build (totales, novedades, retiradas, cobertura de
 * packs/craft/mercado/búsqueda y métricas de generación). Todo derivado, serializable.
 */
import type { MaterializationResult } from "@/materializer";
import type { CatalogStatistics, CatalogDiff, CatalogArtifact, CollectionsArtifact, PacksArtifact, CraftArtifact, MarketplaceArtifact, SearchArtifact } from "./types";

export function buildStats(opts: {
  mat: MaterializationResult;
  catalog: CatalogArtifact;
  diff: CatalogDiff;
  collections: CollectionsArtifact;
  packs: PacksArtifact;
  craft: CraftArtifact;
  marketplace: MarketplaceArtifact;
  search: SearchArtifact;
}): CatalogStatistics {
  const { mat, catalog, diff, collections, packs, craft, marketplace, search } = opts;
  return {
    totalCards: catalog.cards.length,
    totalPlayers: catalog.players.length,
    newCards: diff.added.length,
    updatedCards: diff.updated.length,
    retiredCards: new Set([...diff.removed, ...diff.retired]).size,
    collections: collections.collections.length,
    packsWithChanges: packs.pools.length,
    craftRecipes: craft.recipes.length,
    marketplaceEligible: marketplace.eligible,
    searchEntries: search.rows.length,
    generation: {
      generationId: mat.generationId,
      unchanged: mat.unchanged.length,
      season: mat.collectionPatch.season,
    },
  };
}
