/**
 * FRAME — marco y borde por RAREZA (la rareza viene del CardSpec: aquí JAMÁS se recalcula).
 * Los marcos actuales son recursos `css:` del design system (RarityPalette); si un bucket
 * no tuviera marco, placeholder oficial.
 */
import type { ArtworkEngine } from "@/artwork";
import type { CardSpec } from "@/card-generator";
import { assetElement } from "./composition";
import { slotLayout } from "./layout";
import { resolveSubjectRef } from "./resolver";
import type { ComposedElement } from "./types";

export function composeFrame(spec: CardSpec, artwork: ArtworkEngine): ComposedElement[] {
  return [
    assetElement("frame", "frame", resolveSubjectRef(artwork, "frame", spec.rarityBucket), slotLayout("frame")),
    assetElement("frame", "border", resolveSubjectRef(artwork, "border", spec.rarityBucket), slotLayout("border")),
  ];
}
