/**
 * PUBLISHER — API pública (Card Generator Fase 7/7, FINAL).
 *
 * `publish(build)` → `PublishResult` (transaccional, con auto-rollback) y
 * `rollback(target)` → restauración EXACTA por CatalogFingerprint/GenerationId. Los engines
 * de runtime (`runtimePackEngine`/`runtimeCraftEngine`/`runtimeRegistry`) SIEMPRE siguen el
 * catálogo vigente — resolución definitiva del bug de los singletones congelados. Único
 * módulo con efectos secundarios de todo el pipeline F1→F7.
 */
export * from "./types";
export { publish, validateRuntime } from "./engine";
export { rollback, findSnapshot, restoreSnapshot, validateRestored } from "./rollback";
export {
  runtimeRegistry, runtimePackEngine, runtimeCraftEngine,
  runtimeVersion, runtimeFingerprint, runtimeGenerationId,
  runtimeCollections, runtimeSearch, runtimeMarketEntries, runtimeNews, runtimeSnapshots,
  captureSnapshot, resetRuntime,
} from "./runtime";
export { planInvalidation, commitFingerprints } from "./cache";
export { applyCatalogRuntime } from "./catalog";
export { applyCollectionsRuntime } from "./collections";
export { applyPacksRuntime } from "./packs";
export { applyCraftRuntime } from "./craft";
export { applyMarketplaceRuntime } from "./marketplace";
export { applySearchRuntime } from "./search";
export { applyNewsRuntime } from "./news";
