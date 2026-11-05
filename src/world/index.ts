/**
 * LIVING ESPORTS WORLD — API pública.
 *
 * Un universo de esports que evoluciona solo (temporadas, transferencias, contratos,
 * academia, jubilaciones, rankings, mercado, fanbase, narrativa, historia) componiendo los
 * motores existentes: Player Development (evolución/edad/potencial), live Timeline
 * (carrera/historia), EcoEvent, intel (rating/valor) y el buzón de noticias. Cero motores
 * nuevos de carrera/timeline/market.
 */
export * from "./types";
export { makeRng, seedOf, type Rng } from "./rng";
export { createWorld } from "./init";
export { playSeason, teamStrength, type SeasonResult } from "./season";
export { playerValue, recomputeValues } from "./market";
export { generateRookie } from "./academy";
export { freshContract } from "./contracts";
export { runTransferMarket, manageCoaches } from "./transfers";
export { recomputeRankings } from "./rankings";
export { detectWorldEvents, snapshotWorld, type WorldSnapshot } from "./narrative";
export { worldNews } from "./news";
export { updateHistory, worldChronicle } from "./history";
export { worldBroadcast, type WorldBroadcast, type TeamRow } from "./broadcast";
export { advanceWorld, simulateWorld } from "./simulate";
