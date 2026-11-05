/**
 * QUEUE — transiciones de la cola (pendientes · ejecutándose · completados · reintentables
 * · cancelados), todas PURAS y deterministas. Los reintentos se PLANIFICAN (backoff
 * exponencial + máximo de intentos + cancelación): aquí jamás se ejecuta nada.
 */
import { withTask } from "./registry";
import type { SchedulerRegistry } from "./types";
import type { RetryPolicy, SchedulerClock, WatchTask } from "./types";

const transition = (reg: SchedulerRegistry, task: WatchTask, patch: Partial<WatchTask>, at: number): SchedulerRegistry =>
  withTask(reg, { ...task, ...patch, updatedAt: at });

/** Tareas que TOCAN ahora (pending/retryable con dueAt ≤ now), en orden determinista. */
export function dueTasks(reg: SchedulerRegistry, now: number): WatchTask[] {
  return reg.order
    .map((id) => reg.tasks[id])
    .filter((t) => (t.state === "pending" || t.state === "retryable") && t.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt || b.priority - a.priority || (a.id < b.id ? -1 : 1));
}

/** Marca una tarea como en ejecución (la observará OTRO: el scheduler solo la entrega). */
export function markRunning(reg: SchedulerRegistry, taskId: string, clock: SchedulerClock): SchedulerRegistry {
  const t = reg.tasks[taskId];
  if (!t || (t.state !== "pending" && t.state !== "retryable")) return reg;
  return transition(reg, t, { state: "running", attempt: t.attempt + 1 }, clock());
}

/** Observación completada (informada por el llamador). */
export function markCompleted(reg: SchedulerRegistry, taskId: string, clock: SchedulerClock): SchedulerRegistry {
  const t = reg.tasks[taskId];
  if (!t || t.state !== "running") return reg;
  return transition(reg, t, { state: "completed" }, clock());
}

/** Observación fallida: planifica el reintento con backoff, o cancela al agotar intentos. */
export function markFailed(reg: SchedulerRegistry, taskId: string, retry: RetryPolicy, clock: SchedulerClock, reason?: string): SchedulerRegistry {
  const t = reg.tasks[taskId];
  if (!t || t.state !== "running") return reg;
  const now = clock();
  if (t.attempt >= retry.maxAttempts) {
    return transition(reg, t, { state: "cancelled", reason: reason ?? `agotados ${retry.maxAttempts} intentos` }, now);
  }
  const delay = retry.baseDelayMs * Math.pow(retry.factor, t.attempt - 1);
  return transition(reg, t, { state: "retryable", dueAt: now + delay, reason }, now);
}

/** Cancelación explícita (pending/retryable/running). */
export function cancelTask(reg: SchedulerRegistry, taskId: string, clock: SchedulerClock, reason?: string): SchedulerRegistry {
  const t = reg.tasks[taskId];
  if (!t || t.state === "completed" || t.state === "cancelled") return reg;
  return transition(reg, t, { state: "cancelled", reason: reason ?? "cancelada" }, clock());
}
