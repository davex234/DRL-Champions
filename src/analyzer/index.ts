/**
 * TOURNAMENT ANALYZER — API pública (Card Generator Fase 2/7).
 *
 * Analiza un torneo del Canonical Model (Fase 1) y produce un `TournamentReport` OBJETIVO,
 * serializable y determinista. Read-only: no toca importer/collection/gameplay/career/world.
 * Sin cartas, OVR, rarezas ni traits.
 */
export * from "./types";
export { analyzeTournament } from "./engine";
export { analyzeTeams } from "./team";
export { analyzePlayers } from "./player";
export { computeAwards } from "./awards";
export { computeStory } from "./story";
export { accumulate, roleScores, rolePerformance, type StatLine } from "./aggregate";
export { tournamentType, stageFor } from "./rating";
