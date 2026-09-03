/**
 * ASSET LIFECYCLE & UPDATE ENGINE — API pública (Artwork Pipeline · Fase 5/6).
 *
 * Mantiene actualizado el Artwork Manager: versiona cada asset (historial inmutable con
 * proveedor/licencia/checksum/fechas lógicas), calcula fingerprints por CONTENIDO (jamás
 * rutas), compara estados (diff exacto: nuevos/modificados/eliminados/obsoletos/
 * reutilizables), actualiza solo lo necesario, invalida la cache quirúrgicamente y permite
 * rollback por asset. Entrada y salida = registry; nunca imágenes, nunca cartas.
 */
export * from "./types";
export { contentChecksum, lifecycleFingerprint } from "./fingerprint";
export { makeVersion, currentVersion, getVersion } from "./versions";
export { snapshotManager, indexIncoming } from "./registry";
export { diffStates, changesOf } from "./diff";
export { applyDiff } from "./update";
export { invalidationOf, affectedCompositions, SelectiveCache } from "./cache";
export { historyOf, versionsOf, timeline, auditLifecycle } from "./history";
export { rollbackAsset, type RollbackResult } from "./rollback";
export { computeLifecycleMetrics } from "./metrics";
export { AssetLifecycleEngine, createLifecycleState } from "./engine";
