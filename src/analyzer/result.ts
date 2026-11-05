/**
 * PERFORMANCE ANALYZER — orquestador (Card Generator Fase 3/7). Entrada única `analyze(model,
 * history?)`: ejecuta el Tournament Analyzer de F2 UNA vez (intacto) y lo enriquece con las capas
 * F3. Aquí termina el Analyzer: produce `AnalyzerResult` y NADA más (sin cartas/OVR/rareza/
 * variantes/seriales — eso es Fase 4). Solo lectura del Canonical Model. Puro y determinista.
 */
import type { CanonicalModel } from "@/importer";
import { analyzeTournament } from "./engine";
import { tournamentType } from "./rating";
import { computePerformance } from "./performance";
import { computeAgentMetrics } from "./agents";
import { computeMapMetrics, computeTeamEconomy } from "./maps";
import { computeTimelines } from "./timeline";
import { computeOutliers } from "./outliers";
import { computeAllStar, computeHighlights } from "./candidates";
import { computeNarrativeTags, computeHistoricalContext } from "./context";
import { ANALYZER_RESULT_SCHEMA_VERSION, type AnalyzerResult, type TournamentFact } from "./types";

/**
 * Analiza un torneo: informe F2 íntegro + performance F3. `history` (opcional) son hechos
 * OBJETIVOS de torneos anteriores (extraíbles de AnalyzerResults previos) para el contexto
 * histórico; sin él, el bloque histórico queda vacío con `provided=false`.
 */
export function analyze(model: CanonicalModel, history?: TournamentFact[]): AnalyzerResult {
  const report = analyzeTournament(model);
  const type = tournamentType(model.tournament);
  const { agents, pool } = computeAgentMetrics(model);

  return {
    schemaVersion: ANALYZER_RESULT_SCHEMA_VERSION,
    tournamentId: model.tournament.id,
    report,
    performance: computePerformance(model),
    agents,
    agentPool: pool,
    maps: computeMapMetrics(model),
    economy: computeTeamEconomy(model),
    timelines: computeTimelines(model),
    outliers: computeOutliers(model),
    candidates: {
      mvp: report.mvpCandidates.map((c) => ({ ...c })),
      allStar: computeAllStar(report.players),
      highlights: computeHighlights(model),
    },
    narrativeTags: computeNarrativeTags(report.teams, model),
    historicalContext: computeHistoricalContext(report.teams, report.players, type, history),
  };
}
