/**
 * `npm run tournament:schedule` — Scheduler del Tournament Watcher (F2): planifica CUÁNDO
 * observar cada torneo y muestra el plan + la cola. Nunca observa ni ejecuta nada.
 * Demo offline con el ejemplo oficial (Masters ongoing · Champions upcoming · EMEA finished).
 */
import { WatchEngine } from "@/tournament-watcher";
import type { RawSnapshot } from "@/importer";
import { SchedulerEngine, schedulerMetrics, DEFAULT_POLICY } from "@/tournament-scheduler";

const snap = (id: string, name: string, status: string, live = false): RawSnapshot => ({
  tournament: { id, name, type: "international", tier: "vct-international", status, startDate: "2026-06-05T00:00:00Z" },
  stages: [{ id: "s1", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
  teams: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }],
  players: [{ id: "p1", nick: "One", team: "Alpha" }],
  coaches: [],
  matches: [{ id: `${id}-m1`, stageId: "s1", teamA: "Alpha", teamB: "Beta", status: live ? "live" : status === "finished" ? "finished" : "upcoming", format: "bo3", round: "Semifinal", matchOrder: 1 }],
  maps: [],
  mapStats: [],
  standings: [],
  awards: {},
});

async function main(): Promise<void> {
  const now = Date.now();
  const watcher = new WatchEngine();
  watcher.observeBatch([
    snap("masters-london-2026", "Masters London", "ongoing"),
    snap("champions-2026", "Champions", "upcoming"),
    snap("emea-stage-2026", "EMEA Stage", "finished"),
  ], { at: now });

  const scheduler = new SchedulerEngine(() => now);
  const { plan } = scheduler.planFromWatcher(watcher.registry);
  const m = schedulerMetrics(scheduler.registry);

  const rel = (at: number): string => {
    const ms = at - now;
    if (ms <= 0) return "AHORA";
    if (ms < 60 * 60_000) return `en ${Math.round(ms / 60_000)} min`;
    return `en ${Math.round(ms / 3_600_000)} h`;
  };

  console.log("# Tournament Schedule — plan de observación (sin ejecutar nada)\n");
  for (const t of plan.tasks) {
    console.log(`  · ${t.tournamentId.padEnd(24)} prioridad ${String(t.priority).padStart(3)} (${t.priorityLabel.padEnd(14)}) → observar ${rel(t.dueAt)} · intervalo ${Math.round(t.intervalMs / 60_000)} min`);
  }
  console.log(`\n  torneos: ${m.tournaments} · cola: pendientes ${m.pending} · ejecutándose ${m.running} · completados ${m.completed} · reintentables ${m.retryable} · cancelados ${m.cancelled}`);
  console.log(`  próxima observación: ${plan.nextDueAt ? rel(plan.nextDueAt) : "—"} · huella del plan: ${plan.fingerprint}`);
  console.log(`  intervalos de política: live ${DEFAULT_POLICY.intervals.live / 60_000}m · ongoing ${DEFAULT_POLICY.intervals.ongoing / 60_000}m · upcoming ${DEFAULT_POLICY.intervals.upcoming / 60_000}m · finished ${DEFAULT_POLICY.intervals.finished / 3_600_000}h`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
