/**
 * REGISTRY — estado del scheduler (tareas + orden + contadores por torneo), inmutable y
 * serializable. Ids de tarea DETERMINISTAS (`<torneo>#<n>`): jamás aleatorios.
 */
import { SCHEDULER_SCHEMA_VERSION, type SchedulerRegistry, type WatchTask } from "./types";

export function createSchedulerRegistry(): SchedulerRegistry {
  return { schemaVersion: SCHEDULER_SCHEMA_VERSION, tasks: {}, order: [], perTournament: {} };
}

export function withTask(reg: SchedulerRegistry, task: WatchTask): SchedulerRegistry {
  return {
    ...reg,
    tasks: { ...reg.tasks, [task.id]: task },
    order: reg.order.includes(task.id) ? reg.order : [...reg.order, task.id],
    perTournament: {
      ...reg.perTournament,
      [task.tournamentId]: Math.max(reg.perTournament[task.tournamentId] ?? 0, Number(task.id.split("#")[1] ?? 0)),
    },
  };
}

export function nextTaskId(reg: SchedulerRegistry, tournamentId: string): string {
  return `${tournamentId}#${(reg.perTournament[tournamentId] ?? 0) + 1}`;
}

/** Tarea ACTIVA de un torneo (pending/running/retryable) — máximo una, cero duplicados. */
export function activeTaskOf(reg: SchedulerRegistry, tournamentId: string): WatchTask | undefined {
  for (const id of reg.order) {
    const t = reg.tasks[id];
    if (t.tournamentId === tournamentId && (t.state === "pending" || t.state === "running" || t.state === "retryable")) return t;
  }
  return undefined;
}

/** Auditoría (vacío = íntegro): cero tareas activas duplicadas por torneo. */
export function auditScheduler(reg: SchedulerRegistry): string[] {
  const issues: string[] = [];
  const active = new Map<string, number>();
  for (const id of reg.order) {
    const t = reg.tasks[id];
    if (!t) { issues.push(`orden con tarea inexistente: ${id}`); continue; }
    if (t.state === "pending" || t.state === "running" || t.state === "retryable") {
      active.set(t.tournamentId, (active.get(t.tournamentId) ?? 0) + 1);
    }
  }
  for (const [tid, n] of active) if (n > 1) issues.push(`tareas activas duplicadas para ${tid}: ${n}`);
  return issues;
}
