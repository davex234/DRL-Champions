/**
 * DRL VISUALIZER — contrato de los backends de render.
 *
 * Un backend (SVG, Canvas, Pixi, Three, WebGPU) es algo que sabe pintar un
 * `RenderFrame`. En este proyecto React, el backend es un COMPONENTE que recibe
 * el frame. Para backends imperativos (canvas/3D) se define además una interfaz
 * `ImperativeRenderer` que un componente fino envolverá (useEffect + ref).
 *
 * Sustituir SVG por 3D = escribir otro backend que cumpla este contrato y
 * registrarlo. Nada de la simulación, el director, la cámara o el broadcast cambia.
 */
import type { ComponentType } from "react";
import type { RenderFrame } from "./types";

export type RenderBackend = "svg" | "canvas" | "pixi" | "three" | "webgpu";

export interface RendererProps {
  frame: RenderFrame;
  className?: string;
}

/** Backend declarativo (React). Hoy: SVG. */
export type RendererComponent = ComponentType<RendererProps>;

/**
 * Backend imperativo (futuro: canvas2d/Pixi/Three/WebGPU). Un componente adaptador
 * crea el renderer, llama a `resize`/`render(frame)` por frame y `dispose` al salir.
 */
export interface ImperativeRenderer {
  resize(width: number, height: number): void;
  render(frame: RenderFrame): void;
  dispose(): void;
}
