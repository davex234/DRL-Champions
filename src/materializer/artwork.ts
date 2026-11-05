/**
 * ARTWORK RESOLVER (Fase 5) — SOLO referencias (jamás genera ni renderiza). Completa la
 * referencia de F4 con background gestionado (asset kind existente en domain/assets) y el
 * perfil de render (AnimationLevel de la variante). Determinista.
 */
import type { CardSpec } from "@/card-generator";
import { resolveVariant } from "./variants";
import type { MaterializedArtwork } from "./types";

export function resolveMaterializedArtwork(spec: CardSpec): MaterializedArtwork {
  const v = resolveVariant(spec.variantId);
  return {
    image: spec.artwork.image,
    photoId: spec.artwork.photoId,
    templateAssetKey: spec.artwork.templateAssetKey,
    backgroundAssetKey: `background:variant:${spec.variantId}`,
    palette: spec.artwork.palette,
    renderProfile: v.renderProfile,
  };
}
