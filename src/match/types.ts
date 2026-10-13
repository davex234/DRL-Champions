/**
 * MATCH ENGINE — Tipos del PARTIDO (la nueva unidad principal).
 *
 *      Match  ─►  Round (createRound)  ─►  Simulation (tick)
 *
 * El Match Engine SOLO controla el flujo del partido (inicio, rondas, marcador,
 * cambio de lado, fin). La simulación sigue viviendo en `src/sim`. Estos tipos son
 * PUROS (sin React) y planos (clonables), igual que el resto del motor.
 */
import type { CoachSetup, MatchMemory, MatchRosters, RoundState, Side } from "@/sim";
import type { NarrativeState } from "@/narrative";
import type { EconomyRules, EconomyState } from "@/economy";
import type { RoundPlan } from "@/preparation";
import type { CoachConfig, CoachDecision, CoachEvent } from "@/coach";
import type { MatchLoadouts, BuyEvent, TeamLoadoutSummary } from "@/buy";
import type { CombatEvent } from "@/combat2";
import type { MatchTacticalMemory, TacticalEvent } from "@/tactics";

/** Estados del controlador de partido (máquina de estados, sin ifs gigantes). */
export type MatchPhase =
  | "MATCH_START"
  | "ROUND_PREPARATION"
  | "BUY_PHASE"
  | "ROUND_START"
  | "ROUND_RUNNING"
  | "ROUND_END"
  | "SIDE_SWITCH"
  | "MATCH_END";

/** Los dos equipos del partido (independiente del lado, que cambia a media parte). */
export type TeamSlot = "home" | "away";

export interface MatchScore {
  home: number;
  away: number;
}

/** Regla de victoria CONFIGURABLE: primero a `firstTo`, con ventaja de `winBy`. */
export interface WinRules {
  firstTo: number;
  winBy: number;
}

/** Reglas de prórroga: SOLO arquitectura en esta fase (no implementadas). */
export interface OvertimeRules {
  enabled: boolean;
  firstTo: number;
  winBy: number;
}

export interface MatchConfig {
  /** Semilla maestra; cada ronda deriva la suya de forma determinista. */
  seed: number;
  /** Rosters reales (del Player Mapper): home = equipo del entrenador, away = rival. */
  rosters: MatchRosters;
  /** Lado inicial del equipo home + plan táctico (approach/tempo/agresividad). */
  homeSetup: CoachSetup;
  /** Condición de victoria configurable (no asumir 13). */
  win: WinRules;
  /** Rondas por mitad antes del cambio de lado (no hardcodear 12). */
  switchAfter: number;
  /** Tope de seguridad de rondas (evita bucles imposibles). */
  maxRounds: number;
  /** Prórroga: preparada, desactivada. */
  overtime: OvertimeRules;
  /** Reglas económicas; `null` desactiva el Economy Engine (baseline de comparación). */
  economy: EconomyRules | null;
  /** Si true, la economía alimenta al Tactical Engine (createRound con tactical). */
  useEconomyTactics: boolean;
  /** Si true, el Loadout se integra en el combate (Combat2). */
  useLoadoutCombat: boolean;
  /** Entrenador: IA, manual (concepto fijo) o desactivado. */
  coach: CoachConfig;
  /** Nombres de equipo para narrativa/broadcast (opcional). */
  teamNames?: { home: string; away: string };
  /**
   * FASE 51.1 · Mapa canónico del Tactical Coach sobre el que se PRESENTA el partido. Solo
   * presentación e historial: el motor no lo lee (la simulación sigue en su modelo abstracto).
   */
  mapId?: string;
}

/** Economía de ronda — PLACEHOLDER (la economía real llega en una fase futura). */
export interface RoundEconomyPlaceholder {
  home: string;
  away: string;
}

export interface RoundMvp {
  name: string;
  kills: number;
  team: TeamSlot;
}

/** Una ronda guardada en el historial del partido. */
export interface RoundHistoryEntry {
  /** Número de ronda (1-based). */
  number: number;
  /** Lado que jugó el equipo home en esta ronda. */
  homeSide: Side;
  /** Equipo ganador (home/away). */
  winner: TeamSlot;
  /** Lado ganador (ATK/DEF). */
  winnerSide: Side;
  durationTicks: number;
  durationSeconds: number;
  /** Motivo de fin (detonation/defuse/elimination/timeout…). */
  reason: string;
  mvp: RoundMvp | null;
  /** Impacto de la ronda en el partido (0..100, por cercanía + momento). */
  impact: number;
  /** Marcador tras la ronda. */
  scoreAfter: MatchScore;
  /** Economía (placeholder). */
  economy: RoundEconomyPlaceholder | null;
  /** Plan con el que se preparó la ronda (persistido para análisis/replay). */
  plan: RoundPlan | null;
  /** Decisión del entrenador de esa ronda (null si el coach está desactivado). */
  coach: CoachDecision | null;
  /** Resumen de loadouts de ambos equipos (null si la Buy Phase no corrió). */
  loadout: { home: TeamLoadoutSummary; away: TeamLoadoutSummary } | null;
}

export type MatchEventType =
  | "MATCH_STARTED"
  | "ROUND_PREPARED"
  | "COACH_DECISION"
  | "LOADOUTS_READY"
  | "ROUND_STARTED"
  | "ROUND_FINISHED"
  | "SIDE_SWITCHED"
  | "MATCH_POINT"
  | "VICTORY"
  | "DEFEAT"
  | "MATCH_ENDED";

/** Evento del partido (preparado para Replay y Broadcast). */
export interface MatchEvent {
  type: MatchEventType;
  /** Ronda asociada (null para eventos de partido). */
  round: number | null;
  data: Record<string, unknown>;
}

/** Estado COMPLETO del partido. Plano y clonable; preparado para crecer. */
export interface MatchState {
  config: MatchConfig;
  phase: MatchPhase;
  /** Ronda actual/última (0 antes de empezar). */
  roundNumber: number;
  /** Lado que juega el equipo home AHORA. */
  currentHomeSide: Side;
  score: MatchScore;
  history: RoundHistoryEntry[];
  events: MatchEvent[];
  /** Rondas terminadas (sustrato de Narrative y, en el futuro, Replay). */
  rounds: RoundState[];
  /** Ronda en curso (no terminada) durante ROUND_RUNNING; null en otros estados. */
  currentRound: RoundState | null;
  /** Arrastre mental entre rondas (de `nextRoundMemory`). */
  memory: MatchMemory | null;
  winner: TeamSlot | null;
  loser: TeamSlot | null;
  totalTicks: number;
  totalSeconds: number;
  /** MVP provisional (se recalcula cada ronda) → final al terminar. */
  mvp: RoundMvp | null;
  /** Momentum del partido (-100..100, hacia home). */
  momentum: number;
  /** NarrativeState completo (se construye al terminar). */
  narrative: NarrativeState | null;
  /** Estado económico del partido (null si el Economy Engine está desactivado). */
  economy: EconomyState | null;
  /** Plan de la ronda actual (lo produce ROUND_PREPARATION). */
  currentPlan: RoundPlan | null;
  /** Decisión del entrenador de la ronda actual. */
  currentDecision: CoachDecision | null;
  /** Loadouts de la ronda actual (los produce la BUY_PHASE). */
  currentLoadouts: MatchLoadouts | null;
  /** Significado económico de compra del partido (se rellena al terminar). */
  buyEvents: BuyEvent[];
  /** Significado de combate por equipamiento (se rellena al terminar). */
  combatEvents: CombatEvent[];
  /** Tactical Director 2.0: modelo de rival PERSISTIDO de ambos equipos (anti-strat real). */
  tacticalMemory: MatchTacticalMemory | null;
  /** Significado TÁCTICO del partido (fakes/rotaciones/retakes/lecturas…). Se rellena al terminar. */
  tacticalEvents: TacticalEvent[];
  /** Significado de las DECISIONES del entrenador (timeouts/lecturas/llamadas…). Se rellena al terminar. */
  coachEvents: CoachEvent[];
}

/** Contexto que el Match Engine entrega al Broadcast (marcador/ronda reales). */
export interface MatchBroadcastContext {
  round: number;
  score: { atk: number; def: number };
}
