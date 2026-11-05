/**
 * PLAYER DEVELOPMENT ENGINE — API pública.
 *
 * Evoluciona a los jugadores entre partidos/temporadas reutilizando los motores
 * existentes: lee la experiencia (Narrative/PlayerArc + mental), produce deltas y los
 * inyecta en `RosterEntry.attrs/identity` (el sim los consume sin cambios). Incluye
 * entrenamiento, edad, química, scouting, historia, narrativa y broadcast.
 */
export * from "./types";
export { deriveInnate, freshDevState, ageBand, ageGrowthFactor, clamp100, clamp } from "./innate";
export { extractExperience } from "./experience";
export { evolveAfterMatch, progress, diffChanges } from "./evolve";
export { train } from "./training";
export { advanceSeasonFor, autoProgress } from "./aging";
export { relKey, freshRelationship, updateChemistry, teamChemistry, type ChemMatchInput } from "./chemistry";
export { applyDevelopment } from "./apply";
export { scoutPlayer } from "./scout";
export { detectDevelopmentEvents } from "./narrative";
export { developmentBroadcast, developmentEventsBroadcast, type DevelopmentInfo, type DevelopmentEventSummary } from "./broadcast";
