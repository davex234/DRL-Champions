/**
 * PREVIEW — vista previa WEBP derivada del máster (reescalado determinista; misma
 * metadata). Derivada pura: cero decisiones.
 */
import { resizeTo } from "./export";
import type { RenderMetadata, RenderSize } from "./types";

export function makePreview(masterPng: Buffer, size: RenderSize, meta: RenderMetadata): Promise<Buffer> {
  return resizeTo(masterPng, size, "webp", meta);
}
