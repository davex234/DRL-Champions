/**
 * ARTWORK RENDERER — API pública (Artwork Pipeline · Fase 3/6).
 *
 * Motor PASIVO: ArtworkComposition (única entrada, del Composer congelado) → RenderedArtwork
 * (PNG · WEBP · thumbnail · preview + manifest, todo determinista, con la metadata del
 * render embebida en cada imagen). Jamás recalcula capas, decide assets ni cambia el orden
 * de render: una composición inválida se RECHAZA. Rasterización: sharp/libvips (presente en
 * el proyecto), concurrencia 1 y codecs fijos ⇒ byte a byte reproducible.
 */
export * from "./types";
export { renderKey, renderMetadata, renderFingerprint, sha256 } from "./fingerprint";
export { place, placedAttrs, openDocument, closeDocument, CORNER_RADIUS, type Placed } from "./canvas";
export { AssetMaterializer, publicReader, type LocalReader, type MaterializedImage } from "./images";
export { effectSvg, seeded } from "./effects";
export { elementSvg } from "./layers";
export { buildCardSvg, RenderError } from "./renderer";
export { exportPng, exportWebp, resizeTo, inspectImage } from "./export";
export { makeThumbnail } from "./thumbnail";
export { makePreview } from "./preview";
export { ArtworkRenderer, type RendererOptions } from "./engine";
