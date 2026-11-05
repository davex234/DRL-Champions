/**
 * METRICS — proyección de solo-lectura del estado del ciclo de vida: activos · obsoletos ·
 * eliminados · actualizados en la última pasada · cache invalidada · versiones · eventos.
 */
import type { LifecycleMetrics, LifecycleState, UpdateResult } from "./types";

export function computeLifecycleMetrics(state: LifecycleState, last?: UpdateResult): LifecycleMetrics {
  const all = Object.values(state.assets);
  return {
    active: all.filter((a) => a.status === "active").length,
    obsolete: all.filter((a) => a.status === "obsolete").length,
    removed: all.filter((a) => a.status === "removed").length,
    updated: last ? last.diff.modified.length + last.diff.added.length : 0,
    cacheInvalidated: last?.invalidated.assetIds.length ?? 0,
    versions: all.reduce((n, a) => n + a.versions.length, 0),
    events: all.reduce((n, a) => n + a.history.length, 0),
  };
}
