/**
 * METRICS — proyección de solo-lectura del coordinador: peticiones por estado, eventos
 * procesados y entradas de historial.
 */
import type { CoordinatorMetrics, CoordinatorRegistry } from "./types";

export function coordinatorMetrics(reg: CoordinatorRegistry): CoordinatorMetrics {
  const all = reg.order.map((id) => reg.requests[id]);
  const by = (s: string): number => all.filter((r) => r.state === s).length;
  return {
    requests: all.length,
    pending: by("pending"),
    planned: by("planned"),
    cancelled: by("cancelled"),
    duplicates: by("duplicate"),
    executed: by("executed"),
    events: reg.history.filter((h) => h.kind === "decision").length,
    historyEntries: reg.history.length,
  };
}
