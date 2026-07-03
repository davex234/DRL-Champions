/**
 * PLAYER IDENTITY ENGINE — API pública del módulo de identidad.
 */
export type { Identity, TraitKey } from "./traits";
export {
  TRAIT_KEYS, TRAIT_FAMILIES, neutralIdentity, makeIdentity, clampTrait, unit,
} from "./traits";
export type { MentalState } from "./mental";
export { initialMental, carryMental, decayMental, bumpFromKill, clamp100 } from "./mental";
export {
  tickMental, onKillMental, computePressure, isClutch, composureNow,
  aimMult, reactDelta, tradeRadius, holdSpot, forwardBias, lateralBias, wantsRepeek,
  topByTrait, iglLatencyMult, teamMental, shouldAdapt,
} from "./modifiers";
export { PROFILES, type ArchetypeId } from "./profiles";
