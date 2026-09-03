/**
 * TOURNAMENT WATCHER · RUNTIME SERVICE — API pública (Fase 5/5, FINAL).
 *
 * El loop que mantiene vivo el sistema de vigilancia: Scheduler → Watcher → Auto Pipeline
 * → Notification Hub → dormir → repetir, con lock de instancia única, health, métricas y
 * apagado limpio. Solo coordinación de los módulos congelados: jamás ejecuta Tournament
 * Control, Orchestrator, Publisher ni ningún motor de negocio.
 */
export * from "./types";
export { InMemoryLock, FileLock } from "./lock";
export { createRuntimeState, withStatus, withIteration, withError, zeroLatencies } from "./state";
export { runIteration, type LoopDeps } from "./loop";
export { healthOf } from "./health";
export { runtimeMetrics } from "./metrics";
export { gracefulShutdown, type ShutdownResult } from "./shutdown";
export { TournamentRuntime, type RuntimeDeps } from "./runtime";
export { createTournamentRuntime, type CreateRuntimeOptions, type AssembledRuntime } from "./engine";
