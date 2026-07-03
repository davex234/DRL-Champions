/**
 * DRL BROADCAST — tipos del `BroadcastState`.
 *
 * El Broadcast Engine es el CEREBRO de la retransmisión: transforma el estado
 * público de la partida en información lista para emitir. No dibuja React, no
 * decide nada de juego, no muta la simulación. Los componentes solo MUESTRAN
 * este estado (toda la inteligencia vive aquí).
 */
import type { Side, Phase } from "../sim";
import type { SituationId } from "../spectator";
import type { CameraKind } from "../camera";

export type SpikeStatus = "none" | "carried" | "planted" | "defusing";

export interface MatchInfo {
  map: string;
  site: string;
  coachSide: Side;
  /** Marcador de la serie (en el slice: 0-0; se rellena al terminar). */
  score: { atk: number; def: number };
  round: number;
  timeLeft: number;        // segundos
  timeLabel: string;       // "1:25" o cuenta atrás del spike
  phase: Phase;
  phaseLabel: string;
  spike: SpikeStatus;
}

export interface PlayerInfo {
  id: string;
  name: string;
  role: string;
  alive: boolean;
  isFocus: boolean;
  flashed: boolean;
}

export interface TeamInfo {
  side: Side;
  alive: number;
  total: number;
  players: PlayerInfo[];
  /** Estimación de economía (no hay sistema económico aún → estimada). */
  economyEstimate: number;
  /** Equipamiento aproximado (placeholder, preparado para el futuro). */
  loadout: string;
  /** Ultimates listas (preparado para el futuro → 0). */
  ultReady: number;
}

export interface KillFeedItem {
  killer: string;
  victim: string;
  killerSide: Side;
  victimSide: Side;
  tick: number;
  /** El asesino mantenía el ángulo (no peekeó). */
  angle: boolean;
  /** Esta baja fue un trade (vengó una baja aliada reciente). */
  trade: boolean;
}

export interface BroadcastFlags {
  firstBlood: boolean;
  clutch: boolean;
  clutchSide: Side | null;
  ace: boolean;
  aceBy: string | null;
  trade: boolean;
  plant: boolean;
  defuse: boolean;
  timeout: boolean;        // preparado (no hay mecánica aún)
  tacticalPause: boolean;  // preparado
}

export interface BroadcastEvents {
  killFeed: KillFeedItem[];
  flags: BroadcastFlags;
}

export interface RoundPrediction {
  winner: Side;
  confidence: number; // 0..1
  label: string;
}

export interface BroadcastStats {
  winProb: { atk: number; def: number; coach: number };
  /** Ventaja numérica desde el punto de vista del lado entrenado (+ a favor). */
  numbersAdvantage: number;
  prediction: RoundPrediction;
}

export interface ObserverInfo {
  camera: CameraKind;
  focusPlayerId: string | null;
  focusName: string | null;
  priority: number;
  situation: SituationId;
  reason: string;
}

export interface MvpInfo {
  name: string;
  kills: number;
  side: Side;
}

/** Plan de ronda previsto (lo alimentan Preparation y Coach). */
export interface PlanInfo {
  objective: string;
  buy: string;
  risk: string;
  entry: string;
  tempo: string;
  /** Concepto elegido por el entrenador (opcional). */
  concept?: string;
  /** Confianza del entrenador 0..1 (opcional). */
  confidence?: number;
  /** ¿El entrenador cambió el plan automático inicial? (opcional). */
  changed?: boolean;
}

/** Comparativa de equipamiento por lado (la alimenta la Buy Phase). */
export interface LoadoutSideInfo {
  buy: string;
  value: number;
  firepower: number;
  topWeapon?: string;
}
export interface LoadoutInfo {
  atk: LoadoutSideInfo;
  def: LoadoutSideInfo;
}

export interface BroadcastState {
  match: MatchInfo;
  teams: { atk: TeamInfo; def: TeamInfo };
  events: BroadcastEvents;
  stats: BroadcastStats;
  observer: ObserverInfo;
  /** Máximo killer de la ronda (null si aún no hay bajas). */
  mvp: MvpInfo | null;
  /** Plan previsto de la ronda (null si no se alimenta). */
  plan: PlanInfo | null;
  /** Equipamiento por lado y comparativa (null si no se alimenta). */
  loadout: LoadoutInfo | null;
}
