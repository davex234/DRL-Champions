/**
 * LAYOUT — slots declarativos del lienzo lógico (fracciones 0..1, proporción 5:7):
 * posición · anclaje · escala · rotación · prioridad · alineación · profundidad · opacidad.
 * Nunca píxeles renderizados: el Renderer futuro materializará estas fracciones.
 */
import { LAYER_ORDER, type ElementLayout, type LayerKind } from "./types";

export const CANVAS = { aspectRatio: 5 / 7, unit: "fraction" as const };

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export function makeLayout(layer: LayerKind, over: Partial<ElementLayout> = {}): ElementLayout {
  const priority = over.priority ?? 0;
  return {
    x: clamp01(over.x ?? 0.5),
    y: clamp01(over.y ?? 0.5),
    anchor: over.anchor ?? "center",
    scale: over.scale ?? 1,
    rotation: over.rotation ?? 0,
    priority,
    align: over.align ?? "center",
    depth: LAYER_ORDER.indexOf(layer) * 100 + priority,
    opacity: clamp01(over.opacity ?? 1),
  };
}

/** Slots oficiales (posiciones canónicas de cada elemento de la carta). */
export const SLOTS: Record<string, { layer: LayerKind } & Partial<ElementLayout>> = {
  background:      { layer: "background", x: 0.5, y: 0.5, scale: 1 },
  "bg-glow":       { layer: "background-effects", x: 0.5, y: 0.45, scale: 1.1, opacity: 0.85 },
  "bg-aura":       { layer: "background-effects", x: 0.5, y: 0.5, scale: 1.2, opacity: 0.6, priority: 1 },
  "bg-smoke":      { layer: "background-effects", x: 0.5, y: 0.8, scale: 1, opacity: 0.5, priority: 2 },
  tournament:      { layer: "tournament", x: 0.14, y: 0.09, anchor: "top-left", scale: 0.16, opacity: 0.95 },
  team:            { layer: "team", x: 0.86, y: 0.09, anchor: "top-right", scale: 0.18 },
  player:          { layer: "player", x: 0.5, y: 0.46, anchor: "center", scale: 1 },
  shadow:          { layer: "player", x: 0.5, y: 0.72, scale: 0.9, opacity: 0.55, priority: -1 },
  frame:           { layer: "frame", x: 0.5, y: 0.5, scale: 1 },
  border:          { layer: "frame", x: 0.5, y: 0.5, scale: 1, priority: 1 },
  "badge-slot":    { layer: "badges", x: 0.12, y: 0.52, anchor: "left", scale: 0.11 },
  "icon-country":  { layer: "icons", x: 0.12, y: 0.20, anchor: "top-left", scale: 0.09 },
  "icon-role":     { layer: "icons", x: 0.12, y: 0.28, anchor: "top-left", scale: 0.08, priority: 1 },
  "icon-region":   { layer: "icons", x: 0.12, y: 0.35, anchor: "top-left", scale: 0.08, priority: 2 },
  "icon-agent":    { layer: "icons", x: 0.88, y: 0.28, anchor: "top-right", scale: 0.09, priority: 3 },
  "icon-map":      { layer: "icons", x: 0.88, y: 0.36, anchor: "top-right", scale: 0.09, priority: 4 },
  "icon-collection": { layer: "icons", x: 0.88, y: 0.20, anchor: "top-right", scale: 0.08, priority: 5 },
  "icon-rarity":   { layer: "icons", x: 0.5, y: 0.925, anchor: "bottom", scale: 0.07, priority: 6 },
  "text-ovr":      { layer: "texts", x: 0.12, y: 0.10, anchor: "top-left", align: "left" },
  "text-name":     { layer: "texts", x: 0.5, y: 0.80, anchor: "bottom", priority: 1 },
  "text-rarity":   { layer: "texts", x: 0.5, y: 0.865, anchor: "bottom", priority: 2 },
  "text-collection": { layer: "texts", x: 0.5, y: 0.955, anchor: "bottom", priority: 3 },
  "text-edition":  { layer: "texts", x: 0.88, y: 0.945, anchor: "bottom-right", align: "right", priority: 4 },
  "text-tournament": { layer: "texts", x: 0.5, y: 0.045, anchor: "top", priority: 5 },
  "text-season":   { layer: "texts", x: 0.12, y: 0.945, anchor: "bottom-left", align: "left", priority: 6 },
  "fg-foil":       { layer: "foreground-effects", x: 0.5, y: 0.5, scale: 1, opacity: 0.35 },
  "fg-holo":       { layer: "foreground-effects", x: 0.5, y: 0.5, scale: 1, opacity: 0.4, priority: 1 },
  "fg-particles":  { layer: "foreground-effects", x: 0.5, y: 0.35, scale: 1, opacity: 0.7, priority: 2 },
  "fg-fire":       { layer: "foreground-effects", x: 0.5, y: 0.85, scale: 1, opacity: 0.6, priority: 3 },
  "fg-lightning":  { layer: "foreground-effects", x: 0.5, y: 0.3, scale: 1, opacity: 0.65, priority: 4 },
  overlay:         { layer: "overlay", x: 0.5, y: 0.5, scale: 1, opacity: 0.18 },
  mask:            { layer: "overlay", x: 0.5, y: 0.5, scale: 1, priority: 1 },
  debug:           { layer: "debug", x: 0.02, y: 0.985, anchor: "bottom-left", align: "left", opacity: 0.8 },
};

/** Layout de un slot oficial (con overrides deterministas, p.ej. índice de badge). */
export function slotLayout(slot: keyof typeof SLOTS, over: Partial<ElementLayout> = {}): ElementLayout {
  const s = SLOTS[slot];
  return makeLayout(s.layer, { ...s, ...over });
}
