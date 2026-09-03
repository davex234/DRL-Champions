/**
 * SCHEDULER ENGINE — fachada: lee (SOLO lectura) el registry del Watcher, deriva
 * descriptores y produce el WatchPlan; gestiona la cola (entregar/completar/fallar/
 * cancelar). JAMÁS observa ni ejecuta: quien consuma el plan (fases futuras, decididas
 * por Tournament Control) hará las observaciones.
 */
import type { WatcherRegistry } from "@/tournament-watcher";
import { buildPlan, type PlanOutcome } from "./planner";
import { createSchedulerRegistry } from "./registry";
import { cancelTask, dueTasks, markCompleted, markFailed, markRunning } from "./queue";
import { DEFAULT_POLICY, descriptorOf } from "./schedule";
import type { SchedulePolicy, SchedulerClock, SchedulerRegistry, TournamentDescriptor, WatchTask } from "./types";

export class SchedulerEngine {
  constructor(
    private clock: SchedulerClock,
    public registry: SchedulerRegistry = createSchedulerRegistry(),
    private policy: SchedulePolicy = DEFAULT_POLICY,
  ) {}

  /** Planifica desde descriptores explícitos. */
  plan(descriptors: TournamentDescriptor[]): PlanOutcome {
    const out = buildPlan(this.registry, descriptors, this.policy, this.clock);
    this.registry = out.registry;
    return out;
  }

  /** Planifica desde el registry del Watcher (lectura pura; el watcher NO se ejecuta). */
  planFromWatcher(watcher: WatcherRegistry): PlanOutcome {
    const descriptors = watcher.order.map((id) => descriptorOf(watcher.tournaments[id], this.policy));
    return this.plan(descriptors);
  }

  /** Tareas que tocan ahora, marcándolas en ejecución (la observación es de OTRO). */
  take(): WatchTask[] {
    const due = dueTasks(this.registry, this.clock());
    for (const t of due) this.registry = markRunning(this.registry, t.id, this.clock);
    return due.map((t) => this.registry.tasks[t.id]);
  }

  complete(taskId: string): void { this.registry = markCompleted(this.registry, taskId, this.clock); }
  fail(taskId: string, reason?: string): void { this.registry = markFailed(this.registry, taskId, this.policy.retry, this.clock, reason); }
  cancel(taskId: string, reason?: string): void { this.registry = cancelTask(this.registry, taskId, this.clock, reason); }
}
