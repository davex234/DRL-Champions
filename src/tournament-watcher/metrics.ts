/**
 * METRICS — proyección de solo-lectura del registry: torneos observados/activos/terminados/
 * retirados, revisiones acumuladas y eventos por tipo.
 */
import { countByKind } from "./events";
import { watchStatusOf } from "./state";
import type { WatchMetrics, WatcherRegistry } from "./types";

export function watchMetrics(reg: WatcherRegistry): WatchMetrics {
  const all = Object.values(reg.tournaments);
  const events = all.flatMap((t) => t.history);
  return {
    observed: all.length,
    active: all.filter((t) => watchStatusOf(t) === "tracking").length,
    finished: all.filter((t) => watchStatusOf(t) === "finished").length,
    removed: all.filter((t) => watchStatusOf(t) === "removed").length,
    revisions: all.reduce((n, t) => n + t.revision, 0),
    events: events.length,
    byKind: countByKind(events),
  };
}
