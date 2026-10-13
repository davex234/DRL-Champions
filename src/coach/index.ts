/**
 * COACH DECISION ENGINE — API pública.
 *
 * El cerebro del entrenador: decide conceptos de alto nivel (IA o manual) y reescribe
 * el RoundPlan, modulado por la obediencia del ADN. El Match Engine lo invoca en
 * ROUND_PREPARATION, entre la economía y el plan final.
 */
export { decideCoach, applyCoachToPlan, runCoach, sanitizeConcept, conceptDefaults } from "./engine";
export { buildManualPlan, type ManualCoachInput, type UtilityFocus } from "./manual";
export { aiConcept, computeConfidence, entryToConcept } from "./ai";
export { obedienceProfile } from "./identity";
export {
  coachBroadcastContext, type CoachBroadcastContext,
  coachLiveBroadcast, type CoachLiveBroadcast,
  coachEventsBroadcast, type CoachEventSummary,
} from "./broadcast";
export {
  applyCommand, setIgl, availableCommands, COACH_COMMANDS,
  type CoachCommandId, type CoachCommandMeta, type CoachCommandCategory, type CommandTone,
} from "./command";
export { detectCoachEvents, type CoachEvent, type CoachEventType } from "./narrative";
export {
  compileChalkboard, type ChalkStep, type ChalkStepKind, type ChalkboardPlan,
} from "./chalkboard";
export type {
  CoachConcept, CoachSource, CoachConfig, CoachDecision, CoachContext, ObedienceProfile, CoachResult,
} from "./types";
