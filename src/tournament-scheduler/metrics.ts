/**
 * METRICS — proyección de solo-lectura de la cola: totales por estado, próxima observación
 * y distribución por etiqueta de prioridad.
 */
import type { SchedulerMetrics, SchedulerRegistry } from "./types";

export function schedulerMetrics(reg: SchedulerRegistry): SchedulerMetrics {
  const all = reg.order.map((id) => reg.tasks[id]);
  const active = all.filter((t) => t.state === "pending" || t.state === "retryable");
  const byPriority: Record<string, number> = {};
  for (const t of active) byPriority[t.priorityLabel] = (byPriority[t.priorityLabel] ?? 0) + 1;
  return {
    tournaments: new Set(all.map((t) => t.tournamentId)).size,
    pending: all.filter((t) => t.state === "pending").length,
    running: all.filter((t) => t.state === "running").length,
    completed: all.filter((t) => t.state === "completed").length,
    retryable: all.filter((t) => t.state === "retryable").length,
    cancelled: all.filter((t) => t.state === "cancelled").length,
    nextDueAt: active.length ? Math.min(...active.map((t) => t.dueAt)) : null,
    byPriority,
  };
}
