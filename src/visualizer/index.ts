/**
 * DRL VISUALIZER — API pública.
 * Render API agnóstica del backend: la simulación nunca conoce el render.
 * scene builder (puro) + contrato de backend + registro de renderizadores.
 */
import { SvgRenderer } from "./backends/SvgRenderer";
import type { RenderBackend, RendererComponent } from "./renderer";

export { buildRenderFrame } from "./scene";
export type { SceneInput } from "./scene";
export { SvgRenderer };
export type {
  RenderFrame, RenderEntity, RenderEffect, RenderCamera, RenderWorld,
  RenderTransform, RenderAnimation, UIAnchor, EntityType, EntityState, Team, Vec2, Visibility, EffectKind,
} from "./types";
export type { RendererProps, RendererComponent, ImperativeRenderer, RenderBackend } from "./renderer";

/**
 * Registro de backends. Hoy solo SVG; añadir Canvas/Three/WebGPU = registrar aquí
 * un componente que cumpla `RendererProps`. El resto del proyecto no cambia.
 */
export const RENDERERS: Partial<Record<RenderBackend, RendererComponent>> = {
  svg: SvgRenderer,
};

/** Devuelve el backend pedido (fallback a SVG mientras no existan los demás). */
export function getRenderer(backend: RenderBackend = "svg"): RendererComponent {
  return RENDERERS[backend] ?? SvgRenderer;
}
