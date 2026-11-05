/**
 * UTILITY ENGINE — Tipos del MAPA VIVO.
 *
 * La utilidad deja de ser números: existe LÓGICAMENTE en el mapa. Cada zona tiene un
 * estado dinámico (visión/control/presión/info/riesgo/ocupación/última info/utilidad
 * activa) que se actualiza CONTINUAMENTE. Los agentes no usan "habilidades" sino que
 * generan EFECTOS (crear espacio, negar visión, dar info, retrasar, aislar, forzar
 * rotación, proteger post-plant, abrir/cerrar execute, presionar). Sin gráficos.
 */
import type { Side } from "../sim/types";
import type { ZoneId } from "../sim/map/ascentA";
import type { UtilityKind, SpatialOverlay } from "../spatial/types";

/** Lo que CONSIGUE la utilidad (objetivo táctico, no una habilidad concreta). */
export type EffectType =
  | "create_space" | "deny_vision" | "give_info" | "delay" | "isolate"
  | "force_rotation" | "protect_postplant" | "open_execute" | "close_execute" | "pressure";

/** Estado legible de una zona (derivado de los números). */
export type ZoneStatus =
  | "controlled" | "revealed" | "blocked" | "smoked" | "dangerous"
  | "pressured" | "cleared" | "threatened" | "open" | "closed";

/** Estado dinámico de UNA zona del mapa. */
export interface ZoneState {
  /** Control: -1 (DEF total) .. +1 (ATK total). */
  control: number;
  /** Cuánto VE cada bando esta zona (0..1). */
  vision: { ATK: number; DEF: number };
  /** Amenaza activa sobre la zona (0..1). */
  pressure: number;
  /** Info que cada bando TIENE de la zona (0..1). */
  info: { ATK: number; DEF: number };
  /** Riesgo de cruzarla para cada bando (0..1). */
  risk: { ATK: number; DEF: number };
  /** Ocupación por bando (nº de jugadores). */
  occ: { ATK: number; DEF: number };
  /** Último tick con información de la zona por bando. */
  lastInfoTick: { ATK: number; DEF: number };
  /** Estados legibles derivados (para coach/broadcast/narrativa). */
  status: ZoneStatus[];
}

/** Una utilidad ACTIVA en el mapa (efecto vivo con temporizador). */
export interface ActiveUtility {
  id: string;
  by: string;        // id del jugador que la lanzó
  side: Side;
  kind: UtilityKind; // smoke/molly/recon/cover (mecánica del Spatial Engine)
  effect: EffectType;// qué consigue
  zone?: ZoneId;
  sightline?: [ZoneId, ZoneId];
  startTick: number;
  untilTick: number;
  /** Por qué se lanzó (significado, no UI). */
  objective: string;
}

/** Estado COMPLETO del mapa (vive en RoundState, se actualiza cada tick). */
export interface MapState {
  zones: Record<ZoneId, ZoneState>;
  /** Utilidades activas ahora mismo. */
  active: ActiveUtility[];
  /** Overlay del Spatial Engine derivado de `active` (lo consumen perception/combat). */
  overlay: SpatialOverlay;
  /** Cargas usadas por jugador (id → nº). */
  used: Record<string, number>;
  /** Cargas gastadas y totales por bando. */
  spent: { ATK: number; DEF: number };
  charges: { ATK: number; DEF: number };
  /** Control de mapa agregado por bando (nº de zonas controladas). */
  control: { ATK: number; DEF: number };
}
