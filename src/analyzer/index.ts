/**
 * ANALYZER — API pública (Card Generator: Fase 2 Tournament Analyzer + Fase 3 Performance
 * Analyzer). Descongelado en F3 (2026-07-09) conforme a docs/FROZEN.md ("para descongelar:
 * Fases F3–F7 del Card Generator").
 *
 * Analiza un torneo del Canonical Model (Fase 1) y produce:
 *  - `analyzeTournament(model)` → `TournamentReport` (F2, intacto)
 *  - `analyze(model, history?)` → `AnalyzerResult` (F3: performance/agentes/mapas/economía/
 *    timeline/outliers/candidatos/etiquetas objetivas/contexto histórico + confianza)
 *
 * Read-only, OBJETIVO, serializable y determinista. Aquí TERMINA el Analyzer: sin cartas, OVR,
 * rarezas, variantes ni seriales (eso es la Fase 4). No toca importer/collection/gameplay/career.
 */
export * from "./types";
export { analyzeTournament } from "./engine";
export { analyzeTeams } from "./team";
export { analyzePlayers } from "./player";
export { computeAwards } from "./awards";
export { computeStory } from "./story";
export { accumulate, roleScores, rolePerformance, type StatLine } from "./aggregate";
export { tournamentType, stageFor } from "./rating";
// ── Fase 3 — Performance Analyzer ──
export { analyze } from "./result";
export { computePerformance, confidenceLevel, perfFromLine } from "./performance";
export { computeAgentMetrics } from "./agents";
export { computeMapMetrics, computeTeamEconomy } from "./maps";
export { computeTimelines } from "./timeline";
export { computeOutliers, meanStdev, OUTLIER_MIN_MAPS, OUTLIER_MIN_POPULATION, OUTLIER_Z } from "./outliers";
export { computeAllStar, computeHighlights, HIGHLIGHT_CAP } from "./candidates";
export { computeNarrativeTags, computeHistoricalContext } from "./context";
