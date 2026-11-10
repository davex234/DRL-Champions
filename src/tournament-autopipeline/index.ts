/**
 * TOURNAMENT WATCHER · AUTO PIPELINE COORDINATOR — API pública (Fase 3/5).
 *
 * WatchEvents → política declarativa → deduplicación → PipelineRequests (cola + historial
 * inmutable). Solo COORDINA: jamás ejecuta Orchestrator/Control/Publisher, jamás publica,
 * jamás aprueba, jamás decide nada editorial.
 */
export * from "./types";
export { DEFAULT_DECISION_POLICY, rulePriority } from "./policy";
export { routeEvent, type RoutedDecision } from "./routing";
export { pendingRequestFor, mergeIntoRequest } from "./dedupe";
export { appendHistory, historyOfTournament, historyOfRequest, auditCoordinator } from "./history";
export { markPlanned, markExecuted, cancelRequest, pendingRequests } from "./queue";
export { createCoordinatorRegistry, ingestEvents } from "./planner";
export { coordinatorMetrics } from "./metrics";
export { CoordinatorEngine } from "./engine";
