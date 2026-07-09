/**
 * CATALOG BUILDER — API pública (Card Generator Fase 6/7).
 *
 * `buildCatalog(materialization, ctx)` → `CatalogBuildResult`: catálogo lógico incremental +
 * índices + colecciones + pools + craft + mercado + búsqueda + noticias + manifiesto
 * (CatalogVersion semántica + CatalogFingerprint SHA-256) + estadísticas + diff + validación.
 * Puro: nunca escribe, nunca publica, nunca toca el catálogo vivo ni los stores.
 */
export * from "./types";
export { buildCatalog } from "./engine";
export { applyCatalog, buildIndexes } from "./catalog";
export { buildDiff } from "./diff";
export { buildCollections } from "./collections";
export { buildPacks } from "./packs";
export { buildCraft } from "./craft";
export { buildMarketplace } from "./marketplace";
export { buildSearch } from "./search";
export { buildNews } from "./news";
export { buildManifest, nextCatalogVersion } from "./manifest";
export { buildStats } from "./stats";
export { validateBuild } from "./validation";
