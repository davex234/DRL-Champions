/**
 * FINGERPRINT — huellas del render: `renderKey` (composición+versión+tamaños; clave de
 * cache/incremental, SIN fecha) y `renderFingerprint` (embebida en cada imagen: incluye
 * GenerationId · CardId · ArtworkFingerprint · RenderVersion · fecha lógica). SHA-256 de
 * ficheros para el determinismo byte a byte.
 */
import { createHash } from "node:crypto";
import { artworkHash } from "@/artwork";
import type { ArtworkComposition } from "@/artwork-composer";
import { RENDER_VERSION, type RenderMetadata, type RenderOptions } from "./types";

export function renderKey(comp: ArtworkComposition, opts: RenderOptions): string {
  return artworkHash([
    comp.fingerprint, RENDER_VERSION,
    opts.card.width, opts.card.height, opts.thumbnail.width, opts.preview.width,
  ].join("|"));
}

export function renderMetadata(comp: ArtworkComposition, opts: RenderOptions): RenderMetadata {
  return {
    generationId: comp.generationId ?? opts.generationId ?? "",
    cardId: comp.cardId,
    artworkFingerprint: comp.fingerprint,
    renderVersion: RENDER_VERSION,
    renderedAt: opts.now,
  };
}

export function renderFingerprint(meta: RenderMetadata): string {
  return artworkHash(`${meta.generationId}|${meta.cardId}|${meta.artworkFingerprint}|v${meta.renderVersion}|${meta.renderedAt}`);
}

export const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");
