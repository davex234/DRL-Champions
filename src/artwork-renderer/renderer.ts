/**
 * RENDERER — ArtworkComposition → documento SVG maestro determinista. PASIVO al 100%:
 * valida la composición con la SEGURIDAD del propio Composer (capas oficiales en orden,
 * cero duplicados, refs presentes) y la RECHAZA si no es válida — jamás la corrige,
 * reordena ni completa. Pipeline: cargar assets → capas en orden → layout → máscara →
 * overlays → efectos declarativos. La rasterización vive en export.ts.
 */
import { validateComposition, LAYER_ORDER, type ArtworkComposition } from "@/artwork-composer";
import { closeDocument, openDocument } from "./canvas";
import type { AssetMaterializer } from "./images";
import { elementSvg } from "./layers";
import type { RenderSize } from "./types";

export class RenderError extends Error {
  constructor(message: string, readonly cardId: string) {
    super(message);
    this.name = "RenderError";
  }
}

/**
 * SEGURIDAD del motor pasivo: una composición inválida (capas fuera de orden, duplicados,
 * refs vacías…) se RECHAZA siempre — también en rutas de cache. Jamás se corrige.
 */
export function assertRenderable(comp: ArtworkComposition): void {
  const v = validateComposition(comp);
  if (!v.ok) {
    throw new RenderError(`composición inválida (${v.issues.map((i) => i.code).join(",")}): el Renderer no corrige ni reordena`, comp.cardId);
  }
  if (comp.layers.some((l, i) => l.kind !== LAYER_ORDER[i])) {
    throw new RenderError("capas fuera del orden oficial", comp.cardId);
  }
}

/** Construye el SVG maestro de una carta. Lanza RenderError si la composición no es válida. */
export function buildCardSvg(comp: ArtworkComposition, size: RenderSize, assets: AssetMaterializer): string {
  assertRenderable(comp);

  const parts: string[] = [openDocument(size)];
  for (const layer of comp.layers) {
    if (!layer.elements.length) continue;
    parts.push(`<g data-layer="${layer.kind}">`);
    for (const el of layer.elements) parts.push(elementSvg(el, comp, size, assets));
    parts.push("</g>");
  }
  parts.push(closeDocument());
  return parts.join("");
}
