/**
 * OBSERVER CAMERAS — modos de cámara del espectador (Online Fase 5/7).
 *
 * Free / Player / Coach / Director / Automatic / Timeline. Resuelve el foco/cámara EFECTIVO a
 * partir del modo + la decisión del Director + el foco manual. NO mueve la cámara (eso es
 * `src/camera`); solo decide QUÉ observar. PURO. Read-only.
 */
import type { CameraType, DirectorDecision } from "./types";

export type ObserverCameraMode = "free" | "player" | "coach" | "director" | "automatic" | "timeline";

export interface ObserverCameraState {
  mode: ObserverCameraMode;
  focusPlayerId: string | null;
  focusZone: string | null;
  camera: CameraType;
  freePos: { x: number; y: number } | null;
}

export function initCamera(): ObserverCameraState { return { mode: "automatic", focusPlayerId: null, focusZone: null, camera: "auto", freePos: null }; }

/** Resuelve la cámara efectiva según el modo. Determinista. */
export function resolveCamera(mode: ObserverCameraMode, decision: DirectorDecision, manualFocus: string | null, freePos: { x: number; y: number } | null): ObserverCameraState {
  switch (mode) {
    case "director":
    case "automatic":
      return { mode, focusPlayerId: decision.focusPlayerId, focusZone: decision.focusZone, camera: decision.camera, freePos: null };
    case "player":
      return { mode, focusPlayerId: manualFocus, focusZone: null, camera: "player", freePos: null };
    case "coach":
      return { mode, focusPlayerId: null, focusZone: null, camera: "tactical", freePos: null };  // vista táctica del mapa
    case "timeline":
      return { mode, focusPlayerId: decision.focusPlayerId, focusZone: decision.focusZone, camera: decision.camera, freePos: null };
    case "free":
      return { mode, focusPlayerId: null, focusZone: null, camera: "cinematic", freePos: freePos ?? { x: 0, y: 0 } };
  }
}
