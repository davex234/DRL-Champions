/**
 * ROUND PREPARATION ENGINE — API pública.
 *
 * El cerebro que prepara cada ronda: sintetiza un RoundPlan a partir de Economy,
 * Tactical, Identity y Narrative. El Match Engine lo invoca en ROUND_PREPARATION.
 */
export { buildRoundPlan, planToSetup, isValidPlan, approachForEntry } from "./engine";
export { computePressure } from "./narrative";
export { prepBroadcastContext, type PrepBroadcastContext } from "./broadcast";
export type {
  RoundPlan, PrepContext, PlanEconomy, PlanInfluences, EntryType, RiskLevel, NarrativePressure,
} from "./types";
