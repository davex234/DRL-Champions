/**
 * COACH DECISION ENGINE — Tipos.
 *
 * El entrenador NO juega: decide a alto nivel. Entre Economy y el RoundPlan, el coach
 * (IA o manual) elige un CONCEPTO y reescribe el plan; los jugadores lo siguen más o
 * menos según su ADN (obediencia). Módulo PURO y plano. No mueve jugadores, no compra
 * armas, no toca los cerebros de los demás motores.
 */
import type { Aggression, RosterEntry, Side, Tempo } from "@/sim";
import type { TeamSlot } from "@/economy";
import type { EntryType, PlanEconomy, RiskLevel, RoundPlan } from "@/preparation";

/** Conceptos que el usuario (o la IA) puede elegir. NUNCA órdenes individuales. */
export type CoachConcept =
  | "slow"
  | "default"
  | "explode_a"
  | "explode_b"
  | "fake"
  | "play_picks"
  | "play_retake"
  | "force"
  | "save";

export type CoachSource = "ai" | "manual" | "none";

/** Modo del entrenador en el partido. */
export interface CoachConfig {
  mode: CoachSource;
  /** Concepto fijo en modo manual (sin UI todavía). */
  concept?: CoachConcept;
}

/** La decisión del entrenador para una ronda. Preparado para crecer. */
export interface CoachDecision {
  source: CoachSource;
  concept: CoachConcept;
  primaryObjective: string;
  secondaryObjective: string;
  aggression: Aggression;
  tempo: Tempo;
  mapPriority: string;
  entryType: EntryType;
  economy: PlanEconomy;
  riskLevel: RiskLevel;
  retakePlan: string;
  defensePlan: string;
  fallback: string;
  /** Notas tácticas (significado, no frases de UI). */
  notes: string[];
  /** Confianza del entrenador (0..1). */
  confidence: number;
  /** Campos cambiados respecto al plan automático inicial. */
  changes: string[];
  /** ¿El equipo se desvió del concepto por su ADN (improvisación)? */
  deviated: boolean;
}

/** Contexto que el Match Engine entrega al entrenador. */
export interface CoachContext {
  /** Plan automático de preparación (punto de partida del coach). */
  autoPlan: RoundPlan;
  side: Side;
  /** Roster del equipo entrenado (ADN → obediencia/confianza). */
  roster: RosterEntry[];
  momentum: number;
  lossStreak: number;
  matchPoint: TeamSlot[];
  /** ¿Hubo un ace en la ronda anterior? (confianza). */
  lastRoundAce: boolean;
  seed: number;
}

/** Perfil de obediencia del equipo, derivado del ADN. */
export interface ObedienceProfile {
  /** Adherencia al plan del coach (disciplina). */
  obedience: number;
  /** Tendencia a improvisar (creatividad). */
  improvisation: number;
  /** Tendencia a asumir riesgo (ego). */
  egoRisk: number;
}

/** Resultado del entrenador: el plan FINAL + la decisión enriquecida. */
export interface CoachResult {
  plan: RoundPlan;
  decision: CoachDecision;
}
