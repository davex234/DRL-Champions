/**
 * COACH ENGINE — Decisión MANUAL del entrenador humano.
 *
 * Conecta el panel táctico (estrategia/objetivo/tempo/riesgo/utilidad) con el Coach
 * Engine existente: NO reescribe nada. Construye una `CoachDecision` a partir de las
 * elecciones del jugador y la pasa por `applyCoachToPlan`, de modo que la OBEDIENCIA
 * del ADN sigue mandando (un equipo creativo puede improvisar el concepto del coach).
 *
 * El entrenador ordena CONCEPTOS, nunca jugadores.
 */
import type { Aggression, Tempo } from "@/sim";
import type { RiskLevel } from "@/preparation";
import { applyCoachToPlan, decideCoach } from "./engine";
import type { CoachConcept, CoachContext, CoachResult } from "./types";

/** Prioridad de utilidad del equipo (intención del entrenador). */
export type UtilityFocus = "entry" | "retake" | "defense" | "control" | "save";

/** Todo lo que el entrenador humano decide en la sala táctica. */
export interface ManualCoachInput {
  concept: CoachConcept;
  tempo: Tempo;
  aggression: Aggression;
  riskLevel: RiskLevel;
  primaryObjective: string;
  mapPriority: string;
  utility: UtilityFocus;
}

/**
 * Traduce la decisión del entrenador a un `RoundPlan` final reutilizando el Coach
 * Engine. Parte del concepto (que fija la forma base vía `decideCoach`), aplica los
 * diales explícitos del entrenador y deja que la obediencia del ADN module el
 * resultado (cuando el equipo "obedece", manda el entrenador; cuando "improvisa",
 * revierte a la lectura automática — esto es una FEATURE, no un bug).
 */
export function buildManualPlan(ctx: CoachContext, input: ManualCoachInput): CoachResult {
  const base = decideCoach(ctx, { mode: "manual", concept: input.concept });
  const decision = {
    ...base,
    source: "manual" as const,
    tempo: input.tempo,
    aggression: input.aggression,
    riskLevel: input.riskLevel,
    primaryObjective: input.primaryObjective || base.primaryObjective,
    mapPriority: input.mapPriority || base.mapPriority,
    notes: [...base.notes, `util_${input.utility}`, `obj_${input.primaryObjective}`],
  };
  const result = applyCoachToPlan(ctx, decision);
  result.plan.influences = {
    ...result.plan.influences,
    tactical: `${result.plan.influences.tactical}|util:${input.utility}`,
  };
  return result;
}
