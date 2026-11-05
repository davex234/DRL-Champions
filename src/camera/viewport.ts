/**
 * DRL CAMERA — Viewport y matemática base (PURO, sin React, sin sim, sin Director).
 *
 * El viewport es el estado de la cámara en coordenadas del campo. Toda la
 * suavidad sale de un MUELLE CRÍTICAMENTE AMORTIGUADO (implícito → estable a
 * cualquier dt, sin overshoot, sin saltos). Esta es la base sobre la que se
 * moverán TODAS las cámaras futuras.
 */
import type { CameraKind } from "./profiles";

export interface Vec2 { x: number; y: number }

export const vadd = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const vlen = (a: Vec2): number => Math.hypot(a.x, a.y);
export const vdist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clampN = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Limita la magnitud de un vector a `max`. */
export function clampVec(v: Vec2, max: number): Vec2 {
  const l = vlen(v);
  if (l <= max || l === 0) return v;
  const k = max / l;
  return { x: v.x * k, y: v.y * k };
}

/** Estados de la cámara (para debug y lógica de transición). */
export type CameraState = "idle" | "following" | "transition" | "settling";

export interface Transition {
  active: boolean;
  elapsed: number;  // s transcurridos
  duration: number; // s estimados
}

export interface Viewport {
  center: Vec2;
  zoom: number;
  rotation: number;          // radianes — preparada para el futuro (0 por ahora)

  velocity: Vec2;            // u/s del centro
  zoomVelocity: number;      // /s
  acceleration: Vec2;        // u/s² (derivada, para debug)

  target: Vec2;              // centro objetivo
  targetZoom: number;

  state: CameraState;
  transition: Transition;
  cameraType: CameraKind;

  // Memoria interna de seguimiento → la función de update permanece PURA.
  lastFocusId: string | null;
  lastFocusPos: Vec2 | null;
  focusVel: Vec2;
}

// --- Límites globales (la cámara nunca sale de estos rangos) ---
export const ZOOM = { min: 0.8, max: 4.0 } as const;
export const MAX_SPEED = 1600;      // u/s máximas del centro (anti-salto)
export const MAX_ZOOM_SPEED = 4.0;  // /s máximas del zoom

/** Crea un viewport en reposo centrado en el campo. */
export function createViewport(center: Vec2 = { x: 500, y: 350 }, zoom = 1): Viewport {
  return {
    center: { ...center }, zoom, rotation: 0,
    velocity: { x: 0, y: 0 }, zoomVelocity: 0, acceleration: { x: 0, y: 0 },
    target: { ...center }, targetZoom: zoom,
    state: "idle", transition: { active: false, elapsed: 0, duration: 0 },
    cameraType: "observer",
    lastFocusId: null, lastFocusPos: null, focusVel: { x: 0, y: 0 },
  };
}

/**
 * Paso de muelle críticamente amortiguado IMPLÍCITO (incondicionalmente estable,
 * sin overshoot). `omega` = frecuencia natural (rad/s): mayor = converge antes.
 */
export function springStep(x: number, v: number, target: number, dt: number, omega: number): { x: number; v: number } {
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  return {
    x: (f * x + dt * v + hhoo * target) * det,
    v: (v + hoo * (target - x)) * det,
  };
}
