/**
 * THUMBNAIL — miniatura PNG derivada del máster (reescalado determinista; misma metadata).
 * No re-rasteriza el SVG ni re-decide nada: es una derivada pura del PNG maestro.
 */
import { resizeTo } from "./export";
import type { RenderMetadata, RenderSize } from "./types";

export function makeThumbnail(masterPng: Buffer, size: RenderSize, meta: RenderMetadata): Promise<Buffer> {
  return resizeTo(masterPng, size, "png", meta);
}
