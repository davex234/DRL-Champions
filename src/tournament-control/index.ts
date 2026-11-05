/**
 * TOURNAMENT CONTROL CENTER — API pública (Tournament Automation · Fase 5/5, FINAL).
 *
 * El punto único de control del ciclo de vida de un torneo: importar/generar (Orchestrator o
 * composición pública sin publicar) → revisar/aprobar (Editorial F4) → publicar SOLO lo
 * aprobado (publishApproved) → rollback exacto (Publisher). Todo sobre un `ControlLedger`
 * inmutable y serializable; las vistas (dashboard/detalle/historial/métricas/comparador/
 * búsqueda/filtros) son proyecciones puras. CERO lógica de negocio nueva: solo composición
 * de motores terminados.
 *
 * NOTA: el store (`useControlStore`) es client-only; se importa desde "./store" en la UI para
 * no arrastrar zustand/localStorage a los scripts de verificación.
 */
export * from "./types";
export {
  createLedger, ingestRun, generateForReview, openReview, decideRecordCards,
  approveGenerationRecord, reopenReview, duplicateForReview, type GenerateForReviewCtx,
} from "./engine";
export { publishRecord, rollbackRecord, type RollbackCtx } from "./publish";
export { buildDashboard, dashboardRow, recordStatus, currentRuntimeInfo } from "./dashboard";
export { generationDetail, compareGenerations, type GenerationDetail } from "./generations";
export { reviewRows, reviewCounts, type ControlReviewRow } from "./review";
export { buildHistory } from "./history";
export { buildMetrics, buildReport } from "./metrics";
export { searchControl } from "./search";
export { applyDashboardFilter, sortDashboardRows } from "./filters";
