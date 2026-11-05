/**
 * ARTWORK RESOLVER (Fase 4) — SOLO referencias, nunca imágenes ni render. Convenciones ya
 * existentes: foto = `Player.image` o `/players/{id}.png` (lib/assets), template gestionado =
 * asset `card_template` por variante (domain/assets), marco = paleta del `VariantDef`.
 * Determinista.
 */
import { getVariant } from "@/domain/cards/variants";
import type { Player, VariantId } from "@/domain/cards/types";
import type { CardArtworkRef } from "./types";

export function resolveArtwork(player: Player, variantId: VariantId, photoId?: string): CardArtworkRef {
  const variant = getVariant(variantId);
  return {
    image: player.image ?? `/players/${player.id}.png`,
    photoId,
    templateAssetKey: `card_template:variant:${variantId}`,
    palette: variant.palette,
  };
}
