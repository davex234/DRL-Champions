/**
 * LIVE ECOSYSTEM — API pública.
 *
 * El ecosistema vivo: proveedores (failover/health) → orquestador (pipeline canónico
 * que compone Identity/Rating/Decision/Cards/News + timeline/market/events/challenges)
 * → analytics. Reutiliza Intel + DRL Data Engine; no duplica ni crea otro pipeline.
 */
export { type LiveDataProvider, type ProviderHealth, type ProviderAttempt, viaProviders } from "./provider";
export { makeMockProvider, defaultFixtures, type MockProviderOpts, type MockTournament } from "./mockProvider";
export {
  createTimeline, seasonOf, ensureTournament, ensureTeam, ensurePlayer, historyFor, recordCard, hasCard,
  playerKey, teamKey, type Timeline, type PlayerCareer, type CardRecord,
} from "./timeline";
export { decideMarket, type MarketPolicy } from "./market";
export { generateChallenges, type Challenge } from "./challenges";
export { type EcoEvent, type EcoEventType } from "./events";
export { createAnalytics, finalizeAnalytics, type Analytics } from "./analytics";
export { runLiveCycle, type LiveCycleResult, type LiveCard } from "./orchestrator";
