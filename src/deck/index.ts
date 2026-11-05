/**
 * DECK & SQUAD BUILDER ENGINE — API pública (Collection Fase 3/7).
 *
 * Capa determinista ENTRE Collection y Gameplay que CONSTRUYE el equipo (titulares/suplentes/reservas +
 * capitán/IGL/coach, múltiples decks por tipo) y lo prepara para el Player Mapper. NO juega, NO crea otro
 * roster/Player/Team/Identity/Gameplay: reutiliza `@/domain/teams` (composición+validación), `@/lib/match`
 * (mapper), `@/collection` (filtros), `@/agents` (composición/sinergias) y `@/development` (química).
 * NO abre crafting, marketplace, battle pass ni presentation.
 *
 *   Collection → Deck Builder → Roster Builder (mapper) → Gameplay → Career → Online
 */
export * from "./types";
export { DeckEngine } from "./engine";
export { validateDeck, isPlayable } from "./validate";
export { deckAnalysis, deckCompatibility } from "./analysis";
export { roleCoverage, ALL_CARD_ROLES } from "./roles";
export { deckCandidates, filterOwnedInstances, type DeckFilterOpts, type OwnedInstanceFilter } from "./filters";
export { deckToHomeRoster, deckToRosters } from "./roster";
export { migrateDeck, cloneDeck, exportDeck, serializeDeck, importDeck } from "./io";
// Re-exporta la validación base del dominio (fuente única; las constantes ya salen por `./types`).
export { validateTeam, isTeamValid } from "@/domain/teams/types";
