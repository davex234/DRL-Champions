// ❄️ FROZEN (Consolidation F1.1, 2026-07-06): motor completo y verificado SIN consumidores de
// producto hoy. Se conserva por valor de roadmap (wire before kill). NO crecer ni integrar
// sin decision explicita. Registro y criterios: docs/FROZEN.md
/**
 * MATCHMAKING & QUEUE ENGINE — API pública (Online Fase 2/7).
 *
 * Encuentra partidas y las entrega al ÚNICO Online Core (Fase 1): Queue · Search · Balance ·
 * Region/Latency · Server Selection · Bot Fill/Backfill · Ready Check · Match Builder ·
 * Matchmaker. Modos: casual/competitive/custom/practice/ai_match/lan/offline_local/dedicated.
 * Depende de `@/online` (NUNCA al revés). Reutiliza Elo/rosters/sim. Determinista. Sin O(n²).
 * NO ranking/amigos/torneos.
 */
export * from "./types";
export { defaultProfile, profileFrom, ratingOf, compositionScore } from "./profile";
export { REGIONS, regionPing, pingToServer, bestRegionFor, pairPing } from "./region";
export { matchQuality, teamBalance, acceptable } from "./balance";
export { DEFAULT_SEARCH, expandWindow, estimatedWait, queueHealth, type SearchConfig } from "./search";
export { defaultNodes, kindForMode, selectServer } from "./server";
export { botProfile, fillSide, isBot } from "./botfill";
export { newReadyCheck, accept, decline, tickReady, isReady, isFailed } from "./readycheck";
export { Queue } from "./queue";
export { buildProposal, toLobbyDraft, seedFor, defaultRosterProvider, type RosterProvider } from "./matchBuilder";
export { Matchmaker, defaultMatchmakerConfig, type MatchmakerConfig } from "./matchmaker";
