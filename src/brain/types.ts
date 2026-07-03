/**
 * BRAIN ENGINE — Tipos del CEREBRO del jugador.
 *
 * Cada jugador piensa por evaluación continua (no BT/FSM/árboles): tiene una MEMORIA
 * imperfecta y propia, genera HIPÓTESIS (probabilidades, no hechos), enumera OPCIONES,
 * las puntúa consumiendo TODOS los motores existentes (Identity/Agent/Utility/Economy/
 * Tactical/Spatial/Composition/Mental…) y elige según su PERSONALIDAD, pudiendo dudar y
 * cambiar de idea. Nada es omnisciente: todo nace de visión/sonido/utilidad/comms/memoria.
 */
import type { Side } from "../sim/types";
import type { ZoneId } from "../sim/map/ascentA";

/** Fuente de un recuerdo (afecta a su confianza). */
export type MemorySource = "sight" | "sound" | "recon" | "comm";

/** Recuerdo de un enemigo (última posición conocida). */
export interface EnemyMemo {
  pos: { x: number; y: number };
  tick: number;        // cuándo se supo
  baseConf: number;    // confianza inicial (según fuente)
  source: MemorySource;
}

/** Recuerdo ligado a una zona (utilidad vista, peligro, limpio…). */
export interface ZoneMemo {
  zone: ZoneId;
  tick: number;
  conf: number;
}

/** Memoria del jugador: NUNCA perfecta; se degrada con el tiempo. */
export interface BrainMemory {
  /** Última posición conocida por id de enemigo. */
  enemies: Record<string, EnemyMemo>;
  /** Utilidades detectadas (smoke/recon/molly) por zona. */
  utilSeen: ZoneMemo[];
  /** Último sonido relevante. */
  lastSound: { pos: { x: number; y: number }; tick: number } | null;
  /** Spike visto. */
  spike: { pos: { x: number; y: number }; tick: number; conf: number } | null;
  /** Memoria de peligro/limpieza por zona (0..1, decae). */
  danger: Partial<Record<ZoneId, ZoneMemo>>;
  clear: Partial<Record<ZoneId, ZoneMemo>>;
  /** APRENDIZAJE: dónde se ha visto al rival (por carril) — sesga las hipótesis. */
  laneSeen: { main: number; tree: number; mid: number };
  /** Conteo de fakes detectados (rival que amaga y reubica). */
  fakeSeen: number;
}

/** Una hipótesis del jugador sobre lo que ocurre (probabilidad, no hecho). */
export interface Hypothesis {
  id: string;
  label: string;
  prob: number; // 0..1
}

/** Acciones posibles (átomos de decisión, no un árbol). */
export type OptionKind =
  | "hold" | "wait" | "fall_back" | "push" | "rotate" | "flank"
  | "seek_trade" | "cover_ally" | "play_postplant" | "save" | "fight";

export interface Option {
  kind: OptionKind;
  /** Zona objetivo (movimiento) si aplica. */
  zone?: ZoneId;
  /** Enemigo objetivo (combate/trade) si aplica. */
  enemyId?: string;
  /** Punto concreto (re-peek a última posición) si aplica. */
  point?: { x: number; y: number };
}

/** Opción puntuada + desglose (para el debug). */
export interface ScoredOption extends Option {
  score: number;
  factors: { label: string; value: number }[];
}

/** Decisión final del cerebro este tick. */
export interface Decision {
  option: Option;
  changed: boolean;
  reason: string;
}

/** Mensaje de COMUNICACIÓN entre compañeros (la info viaja, no se teletransporta). */
export type CommType = "contact" | "clear" | "util_spent" | "rotate" | "need_help" | "spike";
export interface CommMessage {
  id: string;
  from: string;
  side: Side;
  type: CommType;
  enemyId?: string;
  pos?: { x: number; y: number };
  zone?: ZoneId;
  sentTick: number;
  arriveTick: number;  // cuándo "llega" (la info viaja)
  quality: number;     // 0..1 (depende de comunicación/liderazgo)
}

/** Traza de razonamiento para el Brain Debug. */
export interface BrainTrace {
  tick: number;
  chosen: OptionKind;
  reason: string;
  changed: boolean;
  options: { kind: OptionKind; score: number }[];
  beliefs: { label: string; prob: number }[];
  knows: string[];
  received: string[];
}

/** Estado del cerebro que vive en cada SimPlayer. */
export interface BrainState {
  memory: BrainMemory;
  lastAction: OptionKind | null;
  lastScore: number;
  changedTick: number;
  trace: BrainTrace | null;
}
