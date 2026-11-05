/**
 * DRL CAMERA — perfiles de cámara.
 *
 * El motor de cámara tiene su PROPIA taxonomía (superset de las cámaras de
 * realización), para no acoplarse al `CameraType` del Director ni modificarlo.
 * Una decisión del Director (`decision.camera`) se traduce a un `CameraKind`.
 * Cada kind define cómo encuadra (zoom, seguimiento, fit de duelo) y su dinámica
 * (rigidez del muelle, anticipación). Esta fase usa un único MOTOR; los perfiles
 * solo cambian parámetros — añadir una cámara nueva = añadir una entrada aquí.
 */
import type { CameraType } from "../spectator";

export type CameraKind =
  | "observer" | "tactical" | "player" | "fps"
  | "clutch" | "plant" | "defuse" | "retake" | "cinematic" | "replay";

export interface CameraProfile {
  /** Zoom objetivo base (1 = mapa completo; mayor = más cerca). */
  baseZoom: number;
  /** Rigidez del muelle del centro (rad/s). */
  centerOmega: number;
  /** Rigidez del muelle del zoom (rad/s). */
  zoomOmega: number;
  /** Anticipación: segundos de "aire" por delante del foco en movimiento. */
  leadTime: number;
  /** ¿Sigue a un jugador (vs. una zona fija)? */
  followsPlayer: boolean;
  /** ¿Ajusta el zoom para encuadrar al jugador y a su rival de duelo? */
  fitDuel: boolean;
}

/**
 * Niveles semánticos de zoom (no valores mágicos sueltos: reglas con nombre).
 * P-1D: abiertos respecto a la base — encuadres demasiado cerrados perdían los
 * duelos por el borde (30% de kills fuera de pantalla). Más contexto = más VCT.
 */
const Z = { tactical: 1.0, wide: 1.3, medium: 1.7, close: 1.9, tight: 2.2 } as const;

export const CAMERA_PROFILES: Record<CameraKind, CameraProfile> = {
  // P-1D: combate más responsivo (omega↑, zoom más rápido) y menos "lead" para no
  // descentrar la acción; zooms más abiertos para no dejar los kills fuera.
  observer:  { baseZoom: Z.medium,   centerOmega: 6.5, zoomOmega: 4.0, leadTime: 0.30, followsPlayer: true,  fitDuel: true },
  tactical:  { baseZoom: Z.tactical, centerOmega: 4.0, zoomOmega: 2.5, leadTime: 0.0,  followsPlayer: false, fitDuel: false },
  player:    { baseZoom: Z.close,    centerOmega: 7.5, zoomOmega: 4.5, leadTime: 0.30, followsPlayer: true,  fitDuel: true },
  fps:       { baseZoom: Z.tight,    centerOmega: 9.0, zoomOmega: 5.0, leadTime: 0.40, followsPlayer: true,  fitDuel: false },
  clutch:    { baseZoom: Z.close,    centerOmega: 7.0, zoomOmega: 4.5, leadTime: 0.25, followsPlayer: true,  fitDuel: true },
  plant:     { baseZoom: Z.medium,   centerOmega: 5.5, zoomOmega: 3.5, leadTime: 0.20, followsPlayer: true,  fitDuel: false },
  defuse:    { baseZoom: Z.medium,   centerOmega: 5.5, zoomOmega: 3.5, leadTime: 0.20, followsPlayer: true,  fitDuel: false },
  retake:    { baseZoom: Z.wide,     centerOmega: 5.0, zoomOmega: 3.0, leadTime: 0.30, followsPlayer: true,  fitDuel: false },
  cinematic: { baseZoom: Z.wide,     centerOmega: 3.0, zoomOmega: 2.0, leadTime: 0.40, followsPlayer: false, fitDuel: false },
  replay:    { baseZoom: Z.close,    centerOmega: 7.0, zoomOmega: 4.0, leadTime: 0.30, followsPlayer: true,  fitDuel: true },
};

/** Traduce la recomendación del Director a un kind del motor de cámara. */
export function fromDirectorCamera(c: CameraType): CameraKind {
  return c === "auto" ? "observer" : c;
}

/** Referencia de "span" visible a zoom 1 (ancho de campo) para el fit de duelos. */
export const BASE_SPAN = 1000;
