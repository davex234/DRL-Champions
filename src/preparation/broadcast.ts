/**
 * ROUND PREPARATION × BROADCAST — alimenta al Broadcast con el plan previsto.
 * No modifica el Broadcast Engine: produce el contexto que este acepta de forma
 * opcional (plan, tipo de compra, nivel de riesgo, objetivo de la ronda).
 */
import type { RoundPlan } from "./types";

export interface PrepBroadcastContext {
  objective: string;
  buy: string;
  risk: string;
  entry: string;
  tempo: string;
}

export function prepBroadcastContext(plan: RoundPlan): PrepBroadcastContext {
  return {
    objective: plan.primaryObjective,
    buy: plan.economy.buy,
    risk: plan.riskLevel,
    entry: plan.entryType,
    tempo: plan.tempo,
  };
}
