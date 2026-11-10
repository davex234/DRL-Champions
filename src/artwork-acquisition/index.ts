/**
 * ASSET ACQUISITION ENGINE — API pública (Artwork Pipeline · Fase 4/6).
 *
 * Detecta los assets que FALTAN para una generación (manifest del Artwork Manager) y los
 * adquiere desde PROVEEDORES configurables (arquitectura abierta: search · download ·
 * metadata · license · priority · health) con el pipeline identidad → búsqueda → selección
 * → descarga → validación → normalización → hash → deduplicación → registro. Su salida son
 * EXCLUSIVAMENTE ArtworkAsset registrados: jamás renderiza ni compone cartas, ni modifica
 * una decisión del Composer.
 */
export * from "./types";
export { slugify, refsOfGeneration, targetsOfGeneration } from "./identity";
export {
  rankProviders, selectCandidate, LocalDirectoryProvider, StaticManifestProvider,
  type AssetFetcher, type StaticManifestEntry,
} from "./providers";
export { scanGeneration, type RequirementScan } from "./resolver";
export { downloadCandidate } from "./download";
export { validateCandidate, sniffFormat, REQUIREMENTS } from "./validation";
export { normalizeCandidate, standardFileName } from "./normalization";
export { DedupeIndex } from "./dedupe";
export { AcquisitionCache } from "./cache";
export { AcquisitionRegistry, SUBJECT_DIRS } from "./registry";
export { AcquisitionEngine, type AcquisitionOptions } from "./engine";
