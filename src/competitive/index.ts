// ❄️ FROZEN (Consolidation F1.1, 2026-07-06): motor completo y verificado SIN consumidores de
// producto hoy. Se conserva por valor de roadmap (wire before kill). NO crecer ni integrar
// sin decision explicita. Registro y criterios: docs/FROZEN.md
/**
 * COMPETITIVE RANKING ENGINE — API pública (Online Fase 3/7).
 *
 * Sistema competitivo completo: MMR (Elo REUTILIZADO) · placements · ligas/divisiones · series de
 * promoción · descenso · rank shield · temporadas + soft reset · decay · leaderboards incrementales
 * (global/regional/coach) · historial · perfil · recompensas (infra). Flujo único: Match End →
 * Competitive Engine → MMR → División → Temporada → Leaderboard → Career/World/Presentation.
 * Determinista, calculado SOLO desde MatchResult autoritativo. NO amigos/party/torneos/clanes.
 */
export * from "./types";
export { LEAGUES, LEAGUE_LABEL, LEAGUE_CONFIG, leagueDef, leagueOrdinal, divisionsOf, isApex, leagueForMmr, divisionForMmr, rankOrdinal, rankLabel } from "./leagues";
export { PLACEMENT_GAMES, DEFAULT_RATING, expectedScore, kFactor, mmrDelta, performanceBonus } from "./mmr";
export { newProfile, recordMatch, winRate, form, inPlacement, rankOf, type MatchInput } from "./profile";
export { newSeasonState, softReset, type SeasonState } from "./season";
export { applyDecay, DEFAULT_DECAY, type DecayConfig } from "./decay";
export { Leaderboard } from "./leaderboard";
export { seasonReward } from "./rewards";
export { CompetitiveEngine, type CompetitiveEngineOptions } from "./engine";
export { profileView, rankUpView, leaderboardView, type CompetitiveProfileView, type RankUpView } from "./broadcast";
