/**
 * ARTWORK COMPOSER — API pública (Artwork Pipeline · Fase 2/6).
 *
 * CardSpec → ArtworkComposition: la descripción EXACTA y determinista de cómo se construye
 * una carta, SOLO con referencias del Artwork Asset Manager (12 capas oficiales en orden,
 * layout fraccional, badges/efectos/textos declarativos, placeholder garantizado). No
 * dibuja, no renderiza, no exporta: la ArtworkComposition será la ÚNICA entrada del futuro
 * Artwork Renderer (que todavía NO existe).
 */
export * from "./types";
export { CANVAS, SLOTS, makeLayout, slotLayout } from "./layout";
export { buildLayers, layerIndex, type LayerElements } from "./layers";
export { assemble, assetElement, validateComposition, type AssembleMeta } from "./composition";
export { resolveSubjectRef, resolveIdRef, resolveFontRef } from "./resolver";
export { composeBackground, composeOverlay } from "./background";
export { composeFrame } from "./frame";
export { deriveBadges, composeBadges, BADGE_RULES } from "./badges";
export { composeIcons } from "./icons";
export { deriveEffects, composeEffects, EFFECT_RULES } from "./effects";
export { composeTexts } from "./texts";
export { composeArtwork } from "./engine";
