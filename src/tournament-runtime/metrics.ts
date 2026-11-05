/**
 * METRICS — agregado de solo-lectura sobre los CUATRO módulos coordinados (cada uno con
 * sus propias métricas congeladas) + los contadores del propio runtime.
 */
import { watchMetrics, type WatcherRegistry } from "@/tournament-watcher";
import { coordinatorMetrics, type CoordinatorRegistry } from "@/tournament-autopipeline";
import { hubMetrics, type HubRegistry } from "@/tournament-notifications";
import type { RuntimeMetrics, RuntimeState } from "./types";

export function runtimeMetrics(
  state: RuntimeState, watcher: WatcherRegistry, coordinator: CoordinatorRegistry, hub: HubRegistry,
): RuntimeMetrics {
  const w = watchMetrics(watcher);
  const c = coordinatorMetrics(coordinator);
  const h = hubMetrics(hub);
  return {
    iterations: state.iterations,
    tournamentsWatched: w.observed,
    eventsEmitted: w.events,
    requestsPending: c.pending,
    requestsTotal: c.requests,
    messagesSent: h.sent,
    messagesPending: h.pending + h.retryable,
  };
}
