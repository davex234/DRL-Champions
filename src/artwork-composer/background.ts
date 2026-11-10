/**
 * BACKGROUND — capa de fondo y overlay/mask (referencias del design system del manager;
 * el fondo concreto por torneo/región llegará cuando existan esos assets: placeholder
 * garantizado mientras tanto).
 */
import type { ArtworkEngine } from "@/artwork";
import { assetElement } from "./composition";
import { slotLayout } from "./layout";
import { resolveIdRef } from "./resolver";
import type { ComposedElement } from "./types";

export function composeBackground(artwork: ArtworkEngine): ComposedElement[] {
  return [assetElement("background", "base", resolveIdRef(artwork, "background", "background:base"), slotLayout("background"))];
}

/** Overlay de acabado + máscara de recorte (referencias; el Renderer decidirá cómo aplicarlas). */
export function composeOverlay(artwork: ArtworkEngine): ComposedElement[] {
  return [
    assetElement("overlay", "finish", resolveIdRef(artwork, "effect", "effect:shine"), slotLayout("overlay")),
    assetElement("overlay", "mask", resolveIdRef(artwork, "border", "border:__mask"), slotLayout("mask")),
  ];
}
