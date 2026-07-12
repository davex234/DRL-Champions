// ❄️ FROZEN (Consolidation F1.1, 2026-07-06): motor completo y verificado SIN consumidores de
// producto hoy. Se conserva por valor de roadmap (wire before kill). NO crecer ni integrar
// sin decision explicita. Registro y criterios: docs/FROZEN.md
/**
 * TOURNAMENT ENGINE — API pública (Online Fase 6/7).
 *
 * Torneos profesionales: single/double elim · swiss · round robin · groups→playoffs · series
 * BO1..BO7 + veto · seeding (random/rank/regional/protected) · lifecycle · admin (pause/DQ/
 * walkover/forfeit) · awards/circuit points. Los partidos se juegan con el ÚNICO Gameplay
 * (reusa makeMatchConfig/simulateMatch/Online). Flujo: Tournament→Bracket→Match→Gameplay→
 * Competitive→Replay→Presentation. Depende de match/sim/online/competitive/replay (no al revés).
 * Determinista. Sin O(n²) (avance incremental). NO crea otro Match/Bracket/Replay/Matchmaking.
 */
export * from "./types";
export { seedTeams, bracketSeedOrder } from "./seed";
export { MAP_POOL, seriesInfo, newSeries, buildVeto, resolveSeries } from "./series";
export { buildSingleElim, buildDoubleElim, buildRoundRobin, buildSwissRound1, nextSwissRound, buildGroupStage, advanceFixture, readyFixtures, pendingCount } from "./bracket";
export { circuitPointsFor } from "./awards";
export { Tournament, gameplayPlay, type TournamentConfig, type TeamInput } from "./engine";
export { bracketView, standingsView, type BracketView } from "./broadcast";
