/**
 * TOURNAMENT WATCHER · WATCH ENGINE — API pública (Tournament Watcher · Fase 1/5).
 *
 * Observa torneos (snapshots inyectados), detecta cambios (diff determinista, fingerprint
 * de contenido sin timestamps ni ids efímeros) y EMITE eventos. Nunca ejecuta acciones:
 * ni pipeline, ni Publisher, ni Tournament Control, ni descargas — solo observación.
 */
export * from "./types";
export { normalizeSnapshot, tournamentIdOf } from "./snapshot";
export { tournamentFingerprint, fingerprintPayload, watchHash } from "./fingerprint";
export { diffSnapshots, type DetectedChange } from "./diff";
export { makeEvents, countByKind } from "./events";
export { watchStatusOf, type WatchStatus } from "./state";
export {
  createWatcherRegistry, withObservation, withRemoval, historyOf, auditRegistry,
} from "./registry";
export { watchMetrics } from "./metrics";
export { WatchEngine } from "./engine";
