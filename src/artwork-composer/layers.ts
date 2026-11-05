/**
 * LAYERS — el orden oficial de capas como estructura: SIEMPRE las 12, en LAYER_ORDER,
 * sin duplicados posibles (se construyen desde un Record parcial, no desde listas).
 */
import { LAYER_ORDER, type ComposedElement, type CompositionLayer, type LayerKind } from "./types";

export type LayerElements = Partial<Record<LayerKind, ComposedElement[]>>;

/** Materializa las 12 capas oficiales en orden (vacías si no aportan elementos). */
export function buildLayers(elements: LayerElements): CompositionLayer[] {
  return LAYER_ORDER.map((kind) => ({
    kind,
    elements: [...(elements[kind] ?? [])].sort((a, b) => a.layout.priority - b.layout.priority || (a.id < b.id ? -1 : 1)),
  }));
}

export const layerIndex = (kind: LayerKind): number => LAYER_ORDER.indexOf(kind);
