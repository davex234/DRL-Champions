/**
 * DRL RENDER — Viewport Renderer (PURO).
 *
 * Convierte un `Viewport` del Camera Engine en los parámetros de un SVG: un
 * `viewBox` (pan + zoom) y un `transform` de rotación (preparado). No dibuja, no
 * depende de React, no toca sim/Director/Camera. La SUAVIDAD ya viene del Camera
 * Engine (el viewport se mueve por muelle); aquí solo se refleja — sin
 * transiciones CSS que peleen con el motor.
 *
 * Es independiente del tamaño de pantalla: el viewBox está en coordenadas del
 * campo y el SVG lo escala a cualquier contenedor (preserveAspectRatio).
 */
import { FIELD } from "../sim";
import type { Viewport } from "../camera";

export interface ViewBox { x: number; y: number; w: number; h: number }

/**
 * Sub-rectángulo del campo visible para una cámara. Mantiene SIEMPRE el aspecto
 * del campo (w/h = FIELD.w/FIELD.h) a cualquier zoom → sin deformación.
 */
export function toViewBox(vp: Viewport): ViewBox {
  const z = vp.zoom > 0 ? vp.zoom : 1;
  const w = FIELD.w / z;
  const h = FIELD.h / z;
  return { x: vp.center.x - w / 2, y: vp.center.y - h / 2, w, h };
}

/** Cadena `viewBox` lista para el atributo del <svg>. */
export function viewBoxString(vp: Viewport): string {
  const b = toViewBox(vp);
  return `${b.x} ${b.y} ${b.w} ${b.h}`;
}

/** Campo completo (cuando no hay cámara): viewBox base. */
export const FULL_VIEWBOX = `0 0 ${FIELD.w} ${FIELD.h}`;

/**
 * Transform de rotación alrededor del centro de la cámara (grados). Vacío si la
 * rotación es 0 — preparado para el futuro sin coste hoy.
 */
export function rotationTransform(vp: Viewport): string {
  if (!vp.rotation) return "";
  const deg = (vp.rotation * 180) / Math.PI;
  return `rotate(${deg.toFixed(3)} ${vp.center.x} ${vp.center.y})`;
}

/** ¿El punto cae dentro del encuadre actual? (foco visible / culling futuro). */
export function isVisible(vp: Viewport, p: { x: number; y: number }, margin = 0): boolean {
  const b = toViewBox(vp);
  return p.x >= b.x - margin && p.x <= b.x + b.w + margin && p.y >= b.y - margin && p.y <= b.y + b.h + margin;
}
