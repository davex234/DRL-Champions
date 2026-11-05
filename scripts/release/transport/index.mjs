/**
 * TRANSPORT / PUBLISH SUBSYSTEM — API pública del sistema de PUBLICACIÓN (Fase 3/7).
 *
 * Totalmente desacoplado del Release Pipeline: este consume el objeto `Release` (PublishEngine)
 * y lo transporta a un destino mediante un Provider intercambiable.
 *
 *   selectProvider → TransportEngine(upload/verify/health/rollback/cleanup) → publishRelease
 */
export { selectProvider, createProvider, FACTORIES } from "./provider.mjs";
export { default as TransportEngine } from "./engine.mjs";
export { publishRelease, collectStaged } from "./publish.mjs";
export { rollbackRelease, planRollback, validateRollback } from "./rollback.mjs";
// Fase 6 — Global Distribution Engine
export { buildTargets, orderTargets, requiredRegionsOf } from "./manager.mjs";
export { distributeRelease, rollbackDistribution } from "./distribute.mjs";
export { withRetry, backoffDelay } from "./retry.mjs";
export { probeHealth, buildProviderHealth, scoreOf } from "./health.mjs";
export { buildCdn } from "./cdn.mjs";
