/**
 * ARTWORK ASSET MANAGER — API pública (Artwork Pipeline · Fase 1/6).
 *
 * Repositorio oficial de los recursos gráficos de las cartas: registro indexado (id/alias/
 * hash/categoría/sujeto), resolución en cascada con placeholder garantizado (player → team
 * → country → tournament → background → frame → icons → effects), cache sin dobles cargas,
 * validación y manifest (duplicados/faltantes/huérfanos/rotos). SOLO administra assets:
 * la composición/renderizado/generación de imágenes son fases posteriores.
 */
export * from "./types";
export {
  artworkHash, declaredHash, makeAsset, placeholderFor, ALL_PLACEHOLDERS,
  playerAsset, teamAsset, countryAsset, tournamentLogoAsset,
  EXISTING_ASSETS, CSS_ASSETS, SEED_ASSETS,
} from "./assets";
export { ArtworkRegistry } from "./registry";
export { resolveSubject, resolveCardArtwork, resolveRef, conventionalAsset } from "./resolver";
export { ArtworkCache } from "./cache";
export { ArtworkLoader } from "./loader";
export { validateAsset, validateAssets } from "./validation";
export { buildManifest, emptyRefs } from "./manifest";
export { ArtworkEngine, type ArtworkEngineOptions } from "./engine";
