/**
 * API pública de la simulación "El Entrenador" (Vertical Slice).
 * La UI solo debe importar desde aquí.
 */
export { createRound, tick, applyCall, nextRoundMemory, TPS, ROUND_TICKS, SPIKE_TICKS } from "./engine";
export type { MatchMemory, MatchRosters, MatchLoadoutsBySide } from "./engine";
export { analyze } from "./analysis";
export type { RoundAnalysis, Cause, Tone } from "./analysis";
export type {
  RoundState, SimPlayer, SimEvent, CoachSetup, CoachCall, CoachCallId,
  Side, Phase, Tempo, Aggression, TeamPlan, Intent,
} from "./types";
export type { Attributes, Role, RosterEntry, SimPlayerMeta, SimLoadout } from "./attributes";
export { ovr } from "./attributes";
// --- Player Identity Engine ---
export type { Identity, TraitKey, MentalState, ArchetypeId } from "./identity";
export {
  TRAIT_KEYS, TRAIT_FAMILIES, neutralIdentity, makeIdentity, initialMental, PROFILES,
} from "./identity";
export { ZONES, WALLS, FIELD, PLANT_ZONE, PLANT_RADIUS } from "./map/ascentA";
export type { ZoneId } from "./map/ascentA";
