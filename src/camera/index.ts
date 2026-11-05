/**
 * DRL CAMERA — API pública del Camera Engine.
 * Motor matemático de cámara, independiente del sim, del Director y de React.
 * Reutilizable por entrenador / espectador / replay / highlights / cinemáticas.
 */
export { createViewport, springStep, ZOOM, MAX_SPEED, MAX_ZOOM_SPEED } from "./viewport";
export type { Viewport, Vec2, CameraState, Transition } from "./viewport";
export { updateCamera } from "./engine";
export type { CameraInput } from "./engine";
export { CAMERA_PROFILES, fromDirectorCamera, BASE_SPAN } from "./profiles";
export type { CameraKind, CameraProfile } from "./profiles";
export { describeCamera, formatCamera } from "./debug";
export type { CameraDebug } from "./debug";
