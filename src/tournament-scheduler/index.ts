/**
 * TOURNAMENT WATCHER · SCHEDULER — API pública (Tournament Watcher · Fase 2/5).
 *
 * Decide cuándo/qué/cada cuánto observar y devuelve un WatchPlan. Política 100% datos
 * (intervalos por estado, prioridades declarativas, backoff configurable, patrón de gran
 * final), reloj inyectable, cola determinista sin duplicados. Jamás ejecuta el Watch
 * Engine, ni Orchestrator, ni Control, ni Publisher.
 */
export * from "./types";
export { fixedClock, steppableClock } from "./clock";
export { DEFAULT_POLICY, descriptorOf, intervalFor, nextObservationAt } from "./schedule";
export { priorityOf } from "./priority";
export {
  createSchedulerRegistry, withTask, nextTaskId, activeTaskOf, auditScheduler,
} from "./registry";
export { dueTasks, markRunning, markCompleted, markFailed, cancelTask } from "./queue";
export { buildPlan, type PlanOutcome } from "./planner";
export { schedulerMetrics } from "./metrics";
export { SchedulerEngine } from "./engine";
