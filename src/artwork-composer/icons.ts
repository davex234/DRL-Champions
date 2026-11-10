/**
 * ICONS — iconografía de la carta: país, rol, región, agente, mapa, colección y rareza.
 * Todo por referencia al Asset Manager (placeholder oficial mientras no existan los
 * iconos reales; hoy solo el país resuelve a asset real vía convención flagcdn).
 */
import type { ArtworkEngine } from "@/artwork";
import type { CardSpec } from "@/card-generator";
import { assetElement } from "./composition";
import { slotLayout } from "./layout";
import { resolveSubjectRef } from "./resolver";
import type { ComposedElement, ComposerCtx } from "./types";

export function composeIcons(spec: CardSpec, ctx: ComposerCtx, artwork: ArtworkEngine): ComposedElement[] {
  const out: ComposedElement[] = [
    assetElement("icons", "country", resolveSubjectRef(artwork, "country", ctx.countryIso?.toLowerCase()), slotLayout("icon-country")),
    assetElement("icons", "role", resolveSubjectRef(artwork, "role", ctx.role), slotLayout("icon-role")),
    assetElement("icons", "region", resolveSubjectRef(artwork, "region", ctx.region), slotLayout("icon-region")),
    assetElement("icons", "collection", resolveSubjectRef(artwork, "collection", ctx.collectionId ?? spec.series), slotLayout("icon-collection")),
    assetElement("icons", "rarity", resolveSubjectRef(artwork, "rarity", spec.rarityBucket), slotLayout("icon-rarity")),
  ];
  if (ctx.agent) out.push(assetElement("icons", "agent", resolveSubjectRef(artwork, "agent", ctx.agent), slotLayout("icon-agent")));
  if (ctx.map) out.push(assetElement("icons", "map", resolveSubjectRef(artwork, "map", ctx.map), slotLayout("icon-map")));
  return out;
}
