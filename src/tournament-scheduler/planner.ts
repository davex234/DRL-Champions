/**
 * PLANNER — descriptores → WatchPlan: crea (o conserva) UNA tarea activa por torneo (cero
 * duplicados), con dueAt = última observación + intervalo de su estado y prioridad
 * declarativa. SOLO devuelve el plan: no observa ni ejecuta nada.
 */
import { watchHash } from "@/tournament-watcher";
import { priorityOf } from "./priority";
import { activeTaskOf, nextTaskId, withTask } from "./registry";
import { intervalFor, nextObservationAt } from "./schedule";
import type { SchedulePolicy, SchedulerClock, SchedulerRegistry, TournamentDescriptor, WatchPlan, WatchTask } from "./types";

export interface PlanOutcome {
  registry: SchedulerRegistry;
  plan: WatchPlan;
  created: number;
  kept: number;
}

export function buildPlan(
  reg: SchedulerRegistry, descriptors: TournamentDescriptor[], policy: SchedulePolicy, clock: SchedulerClock,
): PlanOutcome {
  const now = clock();
  let registry = reg;
  let created = 0, kept = 0;

  for (const d of [...descriptors].sort((a, b) => (a.tournamentId < b.tournamentId ? -1 : 1))) {
    const existing = activeTaskOf(registry, d.tournamentId);
    const { score, label } = priorityOf(d, policy);
    if (existing) {
      // Cero duplicados: se conserva la tarea activa, refrescando prioridad/intervalo.
      registry = withTask(registry, { ...existing, priority: score, priorityLabel: label, intervalMs: intervalFor(d, policy), updatedAt: now });
      kept++;
      continue;
    }
    const task: WatchTask = {
      id: nextTaskId(registry, d.tournamentId),
      tournamentId: d.tournamentId,
      state: "pending",
      dueAt: nextObservationAt(d, now, policy),
      priority: score,
      priorityLabel: label,
      intervalMs: intervalFor(d, policy),
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    };
    registry = withTask(registry, task);
    created++;
  }

  const tasks = registry.order
    .map((id) => registry.tasks[id])
    .filter((t) => t.state === "pending" || t.state === "running" || t.state === "retryable")
    .sort((a, b) => a.dueAt - b.dueAt || b.priority - a.priority || (a.id < b.id ? -1 : 1));

  const plan: WatchPlan = {
    generatedAt: now,
    tasks,
    nextDueAt: tasks.length ? tasks[0].dueAt : null,
    fingerprint: watchHash(JSON.stringify(tasks.map((t) => [t.id, t.state, t.dueAt, t.priority]))),
  };
  return { registry, plan, created, kept };
}
