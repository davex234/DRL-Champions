/**
 * TOURNAMENT ORCHESTRATOR — API pública (Tournament Automation · Fase 2/5).
 *
 * Un único comando ejecuta el pipeline EXISTENTE completo, sin duplicar ni modificar motores:
 *
 *   URL vlr.gg → Importer VLR → Importer → Analyzer → Performance → Card Generator →
 *   Materializer → Catalog Builder → Publisher (transacción + rollback intactos)
 *
 * `runTournamentPipeline(url, ctx)` → `OrchestratorResult` (salidas íntegras de cada motor +
 * métricas + error serializable con stack). `runCli(argv)` = `npm run tournament:generate`.
 */
export * from "./types";
export { runTournamentPipeline } from "./engine";
export { STAGES, type StageDef, type PipelineState } from "./pipeline";
export { resolveCtx, type ResolvedOrchestratorCtx } from "./context";
export { computeMetrics } from "./metrics";
export { runCli, type CliRun } from "./cli";
