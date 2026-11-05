/**
 * TACTICAL INTELLIGENCE ENGINE — API pública.
 *
 * La IA piensa como un equipo: conoce conceptos de Valorant, construye la estrategia
 * en un Tactical Graph de datos (sin scripts ni árboles gigantes), modela al rival y
 * se adapta. Modular: añadir una estrategia futura = añadir conceptos/datos.
 */
export { initRuntime, defaultSeed, stepTactics, commitTick, learnRound, nextEconomy, pistolEconomy, applyBuy, buyOf } from "./engine";
export { CONCEPTS, conceptInfo, ATTACK_CONCEPTS, DEFENSE_CONCEPTS } from "./concepts";
export {
  predictedAttackLane, patternStrength, leastDefendedLane, worstAttackLane, tacticalReads,
} from "./opponent";
export { emptyModel } from "./types";
// — Tactical Director 2.0 —
export { spatialPostPlantZones, controlSpace } from "./spatial";
export { teamStyle, type TeamStyle } from "./style";
export { tacticalPhase, tacticalPhaseLabel } from "./phases";
export { createTacticalMemory, learnMatchRound, type MatchTacticalMemory } from "./memory";
export { tacticalBroadcast, type TacticalBroadcast, type SideTacticalBroadcast } from "./broadcast";
export { detectTacticalEvents, type TacticalEvent, type TacticalEventType } from "./narrative";
export type {
  Lane, Buy, ConceptId, ConceptInfo, ConceptPhase, ConceptOrder, TacticalPhaseId,
  TacticNode, TacticEdge, TacticalPlan, NodeKind, ConditionKind,
  OpponentModel, TeamEconomy, TeamTacticState, TacticalRuntime, TeamSeed, TacticalSetup,
} from "./types";
