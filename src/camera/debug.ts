/**
 * DRL CAMERA — modo Debug. Inspección del estado de la cámara.
 */
import { vlen, type Viewport } from "./viewport";
import type { CameraKind } from "./profiles";

export interface CameraDebug {
  cameraType: CameraKind;
  center: { x: number; y: number };
  target: { x: number; y: number };
  zoom: number;
  speed: number;                 // u/s
  state: Viewport["state"];
  transitionRemaining: number;   // s restantes de transición (0 si no hay)
}

export function describeCamera(vp: Viewport): CameraDebug {
  return {
    cameraType: vp.cameraType,
    center: { x: Math.round(vp.center.x), y: Math.round(vp.center.y) },
    target: { x: Math.round(vp.target.x), y: Math.round(vp.target.y) },
    zoom: Number(vp.zoom.toFixed(2)),
    speed: Math.round(vlen(vp.velocity)),
    state: vp.state,
    transitionRemaining: vp.transition.active
      ? Number(Math.max(0, vp.transition.duration - vp.transition.elapsed).toFixed(2))
      : 0,
  };
}

/** Ej.: "cam=clutch centro=(431,210) obj=(440,205) zoom=3.10 vel=120 estado=following trans=0.0s" */
export function formatCamera(vp: Viewport): string {
  const d = describeCamera(vp);
  return `cam=${d.cameraType} centro=(${d.center.x},${d.center.y}) obj=(${d.target.x},${d.target.y}) `
    + `zoom=${d.zoom.toFixed(2)} vel=${d.speed} estado=${d.state} trans=${d.transitionRemaining.toFixed(1)}s`;
}
