/**
 * LOOP — UNA iteración con el ORDEN EXACTO del contrato:
 *
 *   Scheduler(plan) → take → Watcher(observe) → Auto Pipeline(ingest) →
 *   Notification Hub(plan+dispatch a adaptadores) → informe → (dormir fuera)
 *
 * Solo coordinación: los fallos de fuente se devuelven al Scheduler (fail ⇒ reintento
 * planificado); jamás se ejecuta Control/Orchestrator/Publisher.
 */
import type { WatchEvent, WatchEngine } from "@/tournament-watcher";
import type { SchedulerEngine } from "@/tournament-scheduler";
import type { CoordinatorEngine } from "@/tournament-autopipeline";
import type { NotificationHub } from "@/tournament-notifications";
import type { IterationReport, RuntimeClock, SnapshotSource, StageLatencies } from "./types";

export interface LoopDeps {
  /** Torneos a vigilar aunque el watcher no los conozca todavía (descubrimiento). */
  watchlist: string[];
  scheduler: SchedulerEngine;
  watcher: WatchEngine;
  coordinator: CoordinatorEngine;
  hub: NotificationHub;
  source: SnapshotSource;
  clock: RuntimeClock;
}

export function runIteration(deps: LoopDeps, iteration: number): IterationReport {
  const { scheduler, watcher, coordinator, hub, source, clock } = deps;
  const at = clock();
  const stages: string[] = [];
  const latencies: StageLatencies = { schedulerMs: 0, watchMs: 0, pipelineMs: 0, notificationsMs: 0 };
  const ms = (t0: number): number => Math.max(0, Date.now() - t0);

  // 1) Scheduler: replanifica desde el estado del watcher (+ los de la watchlist aún
  //    desconocidos, con "observar AHORA") y entrega lo vencido.
  let t0 = Date.now();
  stages.push("scheduler:plan");
  const known = new Set(Object.keys(deps.watcher.registry.tournaments));
  const newcomers = deps.watchlist.filter((id) => !known.has(id)).map((tournamentId) => ({
    tournamentId, name: tournamentId, status: "upcoming" as const, live: false,
    phase: "unknown" as const, lastObservedAt: null, revision: 0,
  }));
  if (newcomers.length) scheduler.plan(newcomers);
  const { plan } = scheduler.planFromWatcher(watcher.registry);
  stages.push("scheduler:take");
  const taken = scheduler.take();
  latencies.schedulerMs = ms(t0);

  // 2) Watcher: observa los snapshots que la FUENTE inyectada proporcione.
  t0 = Date.now();
  const events: WatchEvent[] = [];
  let observed = 0, failedObservations = 0;
  for (const task of taken) {
    const snapshot = source(task.tournamentId);
    if (!snapshot) {
      scheduler.fail(task.id, "fuente sin snapshot");
      failedObservations++;
      continue;
    }
    stages.push(`watcher:observe:${task.tournamentId}`);
    const result = watcher.observe(snapshot, { at });
    events.push(...result.events);
    scheduler.complete(task.id);
    observed++;
  }
  latencies.watchMs = ms(t0);

  // 3) Auto Pipeline: eventos → peticiones (deduplicadas).
  t0 = Date.now();
  stages.push("autopipeline:ingest");
  const ingest = coordinator.ingest(events);
  latencies.pipelineMs = ms(t0);

  // 4) Notification Hub: peticiones → mensajes → adaptadores (outbox; cero envíos reales).
  t0 = Date.now();
  stages.push("notifications:plan");
  const notPlan = hub.plan(coordinator.plan(), { events });
  stages.push("notifications:dispatch");
  const out = hub.dispatch();
  latencies.notificationsMs = ms(t0);

  stages.push("sleep");
  return {
    iteration,
    at,
    stages,
    planned: plan.tasks.length,
    taken: taken.length,
    observed,
    failedObservations,
    events: events.length,
    requests: ingest.created.length,
    merged: ingest.merged,
    messages: notPlan.messages.length,
    sent: out.sent,
    latencies,
  };
}
