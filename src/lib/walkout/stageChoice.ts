/**
 * PACK WALKOUT · ¿ESCENARIO 3D O 2D? (puro). El 2D es a la vez el respaldo y la versión de movimiento reducido.
 *
 * 2D cuando: movimiento reducido · no hay WebGL · el contexto se perdió · el escenario 3D falló al cargar · equipo
 * modesto (≤ 2 núcleos o ≤ 2 GB declarados). `forced` (panel DEV) manda sobre todo salvo sobre la falta de WebGL.
 */
export type StageKind = "3d" | "2d";

export interface StageEnv {
  webgl: boolean;
  reduced: boolean;
  lowEnd: boolean;
  contextLost?: boolean;
  loadFailed?: boolean;
  forced?: StageKind | null;
}

export function chooseStage(env: StageEnv): StageKind {
  if (!env.webgl || env.contextLost || env.loadFailed) return "2d";
  if (env.forced) return env.forced;
  if (env.reduced || env.lowEnd) return "2d";
  return "3d";
}

/** Equipo modesto según lo que declara el navegador (si no declara nada, no se asume nada). */
export function isLowEnd(nav: { hardwareConcurrency?: number; deviceMemory?: number } | undefined): boolean {
  if (!nav) return false;
  return (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 2)
    || (typeof nav.deviceMemory === "number" && nav.deviceMemory > 0 && nav.deviceMemory <= 2);
}

/** Tope de densidad de píxeles del lienzo 3D (móvil más bajo: el coste crece con el cuadrado). */
export const dprCapFor = (width: number): number => (width < 640 ? 1.25 : 1.5);

/**
 * WALKOUT 0.8 · POR QUÉ se eligió ese escenario — un código fijo por causa (telemetría sin datos personales y
 * diagnóstico): nunca más un 2D silencioso sin saber por qué.
 */
export type StageBreak = "context" | "model" | "asset" | "runtime" | "timeout";
export type WalkoutStageReason =
  | "WEBGL"               // 3D
  | "REDUCED_MOTION"      // el sistema pide menos movimiento (modo Automático)
  | "USER_REDUCED"        // el jugador eligió «Reducidas» (lo pone PackWalkout, que conoce la preferencia)
  | "WEBGL_UNAVAILABLE"
  | "WEBGL_CONTEXT_LOST"
  | "MODEL_LOAD_FAILED"   // la persona (glTF/bin/texturas) no cargó
  | "ASSET_LOAD_FAILED"   // el código del escenario 3D (chunk de three.js) no descargó
  | "RUNTIME_ERROR"       // la escena 3D lanzó al crearse o al pintar
  | "TIMEOUT"             // la persona no estuvo lista a tiempo
  | "LOW_END_DEVICE"
  | "FORCED";             // panel DEV del prototipo

const BREAK_REASON: Record<StageBreak, WalkoutStageReason> = {
  context: "WEBGL_CONTEXT_LOST", model: "MODEL_LOAD_FAILED", asset: "ASSET_LOAD_FAILED", runtime: "RUNTIME_ERROR", timeout: "TIMEOUT",
};

export function stageReason(kind: StageKind, env: { webgl: boolean; reduced: boolean; lowEnd: boolean; forced?: StageKind | null; broken?: StageBreak | null }): WalkoutStageReason {
  if (kind === "3d") return "WEBGL";
  if (env.broken) return BREAK_REASON[env.broken];
  if (!env.webgl) return "WEBGL_UNAVAILABLE";
  if (env.forced === "2d") return "FORCED";
  if (env.reduced) return "REDUCED_MOTION";
  if (env.lowEnd) return "LOW_END_DEVICE";
  return "FORCED";
}

/** Tiempo máximo para que la persona 3D esté lista antes de pasar al 2D (la carta nunca espera a un modelo colgado). */
export const HUMAN_READY_TIMEOUT_MS = 15_000;
