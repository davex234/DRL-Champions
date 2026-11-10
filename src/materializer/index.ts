/**
 * MATERIALIZER — API pública (Card Generator Fase 5/7).
 *
 * `materialize(genResult, ctx)` → `MaterializationResult`: CardDefs definitivos + patches
 * INCREMENTALES (catálogo/colecciones/packs/craft/mercado) con huella SHA-256 y procedencia
 * completa. Motor puro: nunca decide cartas (F4), nunca escribe (aplicación = F6). No toca
 * catálogo vivo, Collection, stores, packs, marketplace ni gameplay.
 */
export * from "./types";
export { materialize } from "./engine";
export { fingerprintSpec, canonicalJson, defaultDigest } from "./patches";
export { buildCardDef, buildMaterializedCard } from "./card";
export { resolveUpserts } from "./identity";
export { buildCatalogPatch } from "./catalog";
export { buildCollectionPatch } from "./collections";
export { buildPackPatch } from "./packs";
export { buildCraftPatch } from "./craft";
export { buildMarketPatch } from "./market";
export { resolveVariant } from "./variants";
export { resolveMaterializedArtwork } from "./artwork";
