/**
 * AGENT ENGINE — API pública.
 *
 * El motor de agentes: capacidades (no habilidades), catálogo de datos, asignación por
 * rol+ADN, análisis de composición emergente e IA de utilidad. Añadir un agente nuevo
 * = un objeto en `catalog.ts`; el núcleo del juego no se toca. Lo consumen Tactical,
 * Combat, Coach, Preparation, Broadcast y Narrative.
 */
export {
  CAPABILITIES, CAPABILITY_LABEL, uniformProfile, makeProfile, addProfiles, scaleProfile, dominant,
  type Capability, type CapabilityProfile,
} from "./capabilities";
export type { AgentClass, AgentDef, AgentInstance, UtilityKit, UtilityObjective } from "./types";
export { CLASS_LABEL } from "./types";
export { AGENTS, getAgent, agentsByClass } from "./catalog";
export { buildLineup, masteryOf, type AssignInput } from "./assign";
export {
  analyzeComposition, compareCompositions,
  type CompositionProfile, type CompositionRatings, type CompositionMatchup,
} from "./composition";
export {
  planTeamUtility, usedByPhase,
  type UtilityPlan, type UtilityIntent, type UtilityPhase,
} from "./utilityAI";
