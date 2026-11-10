/**
 * ROUND PREPARATION ENGINE — Tipos del "cerebro que prepara la ronda".
 *
 * Entre el final de una ronda y el inicio de la siguiente se decide TODO lo
 * estratégico: el `RoundPlan`. Lo sintetizan, sin mandar sobre la ronda, el Economy
 * Engine (compra/riesgo), el Tactical Engine (traducción a plan), Player Identity
 * (temperamento del ADN) y la Narrative (presión del partido). El Match Engine solo
 * coordina y lanza la ronda con este plan.
 *
 * Módulo PURO y plano (clonable). No simula, no compra armas, no toca otros motores.
 */
import type { Aggression, RosterEntry, Side, Tempo } from "@/sim";
import type { BuyDecision, BuyTier, EconomyState, TeamSlot } from "@/economy";

/** Tipo de entrada/setup de la ronda (vocabulario táctico de alto nivel). */
export type EntryType =
  | "default"        // ATK: control + ejecución estándar
  | "fast_execute"   // ATK: ejecución rápida
  | "contact"        // ATK: duelos rápidos (force)
  | "fake"           // ATK: finta y reubicación
  | "eco_rush"       // ATK: rush agrupado de eco
  | "stack"          // DEF: apila un sitio
  | "aggro_info"     // DEF: información agresiva
  | "hold_default";  // DEF: defensa estándar

export type RiskLevel = "low" | "medium" | "high";

/** Parte económica del plan (la entrega el Economy Engine; nunca compra armas). */
export interface PlanEconomy {
  buy: BuyTier;
  risk: number;
  /** Capacidad de compra (0..~1.2). */
  capacity: number;
  recommendation: string;
}

/** Procedencia del plan: qué aportó cada motor (significado, no UI). */
export interface PlanInfluences {
  economy: string;
  identity: string;
  narrative: string;
  tactical: string;
}

/** El plan de una ronda. Preparado para crecer. */
export interface RoundPlan {
  round: number;
  /** Lado que juega el equipo entrenado esta ronda. */
  side: Side;
  primaryObjective: string;
  secondaryObjective: string;
  tempo: Tempo;
  /** Lado/área prioritaria del mapa. */
  prioritySide: string;
  entryType: EntryType;
  /** Approach que consume el sim (deriva de `entryType`). */
  approach: string;
  aggression: Aggression;
  economy: PlanEconomy;
  riskLevel: RiskLevel;
  retakePlan: string;
  defensePlan: string;
  /** Condiciones de cambio (adaptación en ronda). */
  changeConditions: string[];
  /** Plan B. */
  fallback: string;
  influences: PlanInfluences;
}

/** Lo que el Match Engine entrega al preparador para sintetizar el plan. */
export interface PrepContext {
  round: number;
  side: Side;
  score: { home: number; away: number };
  /** Equipos a match point (para presión/decisión). */
  matchPoint: TeamSlot[];
  /** Momentum del partido (-100..100 hacia home). */
  momentum: number;
  /** Roster del equipo entrenado (para el temperamento del ADN). */
  homeRoster: RosterEntry[];
  /** Economía del partido (o null si el Economy Engine está desactivado). */
  economy: EconomyState | null;
  /** Semilla determinista para desempates. */
  seed: number;
}

/** Presión narrativa derivada del contexto (no toca el Narrative Engine). */
export interface NarrativePressure {
  value: number; // 0..1
  tags: string[];
}

/** Decisión por defecto cuando el Economy Engine está desactivado (full buy nominal). */
export const DEFAULT_DECISION: BuyDecision = {
  tier: "full", status: "stable", risk: 0.2,
  canFullBuy: true, shouldEco: false, forceWorth: false, shouldSave: false,
  reasons: ["no_economy"],
};
