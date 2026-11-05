/**
 * DRL SPECTATOR — tipos del Director de Realización.
 *
 * El Director es el CEREBRO que decide qué debe ver el espectador. No renderiza,
 * no dibuja, no mueve la cámara: solo toma decisiones a partir del estado público
 * del simulador (que nunca modifica). Capa totalmente independiente de `src/sim`.
 */
import type { RoundState, SimEvent, ZoneId } from "../sim";

/** Tipo de cámara recomendado (la mueve otra capa, no el Director). */
export type CameraType =
  | "auto" | "tactical" | "player" | "clutch" | "plant" | "defuse" | "retake" | "cinematic";

/** Situación detectada en la ronda. */
export type SituationId =
  | "clutch" | "defuse" | "plant" | "retake"
  | "first_duel" | "trade" | "duel" | "lurk"
  | "rotation" | "default" | "lull";

/** Familia de la situación (para interrupciones duras por cambio de nivel). */
export type SituationTier = "critical" | "combat" | "tactical";

export const TIER_RANK: Record<SituationTier, number> = { critical: 3, combat: 2, tactical: 1 };

/** Entrada del Director: estado actual + información pública. */
export interface DirectorInput {
  state: RoundState;
  tick: number;
  events: SimEvent[];
  /** Snapshots recientes. Reservado para análisis temporal; el LiveDirector no lo necesita. */
  history?: RoundState[];
}

/** Salida del Director: SOLO una decisión de qué observar. */
export interface DirectorDecision {
  focusPlayerId: string | null;
  focusZone: ZoneId | null;
  priority: number;          // 0..100
  camera: CameraType;
  situation: SituationId;
  tier: SituationTier;
  reason: string;
  sinceTick: number;         // desde qué tick se sigue este foco (memoria)
  expectedHoldTicks: number; // duración prevista de seguimiento
}

export interface DirectorConfig {
  tps: number;
  /** Tiempo mínimo de seguimiento antes de permitir un cambio "blando". */
  minFollowTicks: number;
  /** Histéresis: cuánto debe superar un candidato al foco actual para cambiar. */
  switchMargin: number;
  /** Bonus de permanencia del foco actual (decae con el tiempo). */
  stickyBonus: number;
  /** En cuántos ticks decae el sticky hasta 0 (tras el mínimo de seguimiento). */
  stickyDecayTicks: number;
  debug: boolean;
}

export const DEFAULT_CONFIG: DirectorConfig = {
  tps: 20,
  minFollowTicks: 58,    // ~2.9 s — P-1D: planos algo más largos, menos picado
  switchMargin: 10,      // P-1D: más histéresis para no saltar entre duelos
  stickyBonus: 20,       // P-1D: el foco actual "pesa" más antes de soltarlo
  stickyDecayTicks: 90,  // ~4.5 s
  debug: false,
};

/** Candidato de foco propuesto por los detectores de prioridad. */
export interface FocusCandidate {
  situation: SituationId;
  tier: SituationTier;
  focusPlayerId: string | null;
  focusZone: ZoneId | null;
  priority: number;
  camera: CameraType;
  reason: string;
}

export interface DebugEntry {
  tick: number;
  name: string;
  focusPlayerId: string | null;
  situation: SituationId;
  priority: number;
  reason: string;
  holdTicks: number;
}

/**
 * Interfaz COMÚN para ambos directores: el `LiveDirector` (presente, sin
 * foresight, esta fase) y el futuro `ReplayDirector` (modo espectador con la
 * Timeline completa y conocimiento del futuro). Misma firma → intercambiables.
 */
export interface Director {
  decide(input: DirectorInput): DirectorDecision;
  reset(): void;
  readonly debugLog: ReadonlyArray<DebugEntry>;
}
