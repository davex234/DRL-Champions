/**
 * AGENT ABILITY ENGINE — API pública (Gameplay Fase 3/7).
 *
 * Habilidades = DATOS (catálogo). El Brain DECIDE (decide), el motor APLICA (apply) reutilizando
 * Utility/Combat/Perception/Spatial. Escalable: añadir el agente nº100 = añadir su kit; sus
 * abilities salen del catálogo sin tocar motores.
 */
export { ABILITIES, getAbility, abilityFor } from "./catalog";
export { abilitiesFor, abilityIdsFor } from "./agentAbilities";
export { chooseAbility, type DeployCtx } from "./decide";
export { applyAbility } from "./apply";
export { abilityBroadcast, type AbilityBroadcast, type SideAbilityBroadcast, type AbilityCastLine } from "./broadcast";
export { detectAbilityEvents, type AbilityEvent, type AbilityEventType } from "./narrative";
export { emptyAbilityState, type Ability, type AbilityEffect, type AbilityState, type AbilityChoice, type AbilityCombatMod, type AbilityTarget } from "./types";
