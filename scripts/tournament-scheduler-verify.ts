/**
 * VERIFICACIÓN DEL SCHEDULER (Tournament Watcher · Fase 2/5).
 *
 * SOLO planifica: cuándo/qué/cada cuánto observar. Ejemplo obligatorio: Masters London
 * (ongoing) → 2 min · Champions (upcoming) → 30 min · EMEA Stage (finished) → 24 h — sin
 * ejecutar ninguna observación. Comprueba: prioridades · planificación · cola ·
 * determinismo · reloj inyectable · múltiples torneos · rendimiento · cero duplicados ·
 * reintentos · cancelaciones · integración con el Watcher · cero ejecución del Watch Engine.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { RawSnapshot } from "@/importer";
import { resetRuntime, runtimeVersion } from "@/publisher";
import { totalCards } from "@/data/catalog";
import { WatchEngine } from "@/tournament-watcher";
import {
  SchedulerEngine, DEFAULT_POLICY, descriptorOf, priorityOf, intervalFor, nextObservationAt,
  fixedClock, steppableClock, auditScheduler, schedulerMetrics, dueTasks,
  type TournamentDescriptor,
} from "@/tournament-scheduler";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const NOW = 1_700_000_000_000;
const MIN = 60_000;

const snap = (id: string, name: string, status: string, opts: { live?: boolean; round?: string; stageKind?: string } = {}): RawSnapshot => ({
  tournament: { id, name, type: "international", tier: "vct-international", status, startDate: "2026-06-05T00:00:00Z" },
  stages: [{ id: "s1", name: "Etapa", kind: opts.stageKind ?? "playoff", orderIdx: 0 }],
  teams: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }],
  players: [{ id: "p1", nick: "One", team: "Alpha" }],
  coaches: [],
  matches: [{ id: `${id}-m1`, stageId: "s1", teamA: "Alpha", teamB: "Beta", status: opts.live ? "live" : status === "finished" ? "finished" : "upcoming", format: "bo3", round: opts.round ?? "Semifinal", matchOrder: 1 }],
  maps: [],
  mapStats: [],
  standings: [],
  awards: {},
});

const desc = (over: Partial<TournamentDescriptor>): TournamentDescriptor => ({
  tournamentId: "t", name: "T", status: "ongoing", live: false, phase: "unknown",
  lastObservedAt: NOW, revision: 1, ...over,
});

function main(): void {
  console.log("# Verificación del Scheduler — DRL Champions (Tournament Watcher Fase 2/5)\n");

  resetRuntime();
  const cardsBefore = totalCards();

  // ── 1. EJEMPLO OBLIGATORIO (3 torneos → plan exacto) ──
  console.log("## 1. Ejemplo obligatorio — Masters 2min · Champions 30min · EMEA 24h");
  const watcher = new WatchEngine();
  watcher.observeBatch([
    snap("masters-london-2026", "Masters London", "ongoing"),
    snap("champions-2026", "Champions", "upcoming"),
    snap("emea-stage-2026", "EMEA Stage", "finished"),
  ], { at: NOW });
  const watcherJson = JSON.stringify(watcher.registry);

  const scheduler = new SchedulerEngine(fixedClock(NOW));
  const { plan, created } = scheduler.planFromWatcher(watcher.registry);
  const due = (id: string): number => plan.tasks.find((t) => t.tournamentId === id)!.dueAt - NOW;
  console.log(`   ${plan.tasks.map((t) => `${t.tournamentId}→+${(t.dueAt - NOW) / MIN}min`).join(" · ")}`);
  check("Masters (ongoing) → observar en 2 min", due("masters-london-2026") === 2 * MIN);
  check("Champions (upcoming) → observar en 30 min", due("champions-2026") === 30 * MIN);
  check("EMEA (finished) → observar en 24 h", due("emea-stage-2026") === 24 * 60 * MIN);
  check("solo el PLAN: el Watch Engine no se ejecutó (registry del watcher intacto)",
    created === 3 && JSON.stringify(watcher.registry) === watcherJson);
  check("orden del plan: por dueAt y prioridad", plan.tasks[0].tournamentId === "masters-london-2026" &&
    plan.nextDueAt === NOW + 2 * MIN);

  // ── 2. PRIORIDADES (declarativas, primera regla gana) ──
  console.log("\n## 2. Prioridades");
  const p = (d: TournamentDescriptor): number => priorityOf(d, DEFAULT_POLICY).score;
  const live = p(desc({ live: true, phase: "group" }));
  const playoff = p(desc({ status: "ongoing", phase: "playoff" }));
  const final = p(desc({ status: "ongoing", phase: "grand-final" }));
  const group = p(desc({ status: "ongoing", phase: "group" }));
  const upcoming = p(desc({ status: "upcoming" }));
  const finished = p(desc({ status: "finished" }));
  check("en directo > playoffs > gran final > grupos > próximos > terminados",
    live > playoff && playoff > final && final > group && group > upcoming && upcoming > finished,
    `${live}>${playoff}>${final}>${group}>${upcoming}>${finished}`);
  check("derivación de fase desde DATOS del snapshot (stage.kind + patrón de ronda)",
    descriptorOf(watcher.registry.tournaments["masters-london-2026"]).phase === "playoff" && (() => {
      const w2 = new WatchEngine();
      w2.observe(snap("gf", "GF", "ongoing", { round: "Grand Final" }), { at: NOW });
      w2.observe(snap("grp", "GRP", "ongoing", { stageKind: "group", round: "Jornada 1" }), { at: NOW });
      return descriptorOf(w2.registry.tournaments["gf"]).phase === "grand-final" &&
        descriptorOf(w2.registry.tournaments["grp"]).phase === "group";
    })());
  check("los directos usan SU intervalo (manda sobre el estado)",
    intervalFor(desc({ live: true, status: "ongoing" })) === DEFAULT_POLICY.intervals.live &&
    intervalFor(desc({ status: "archived" })) === DEFAULT_POLICY.intervals.archived);
  check("torneo jamás observado → observar AHORA",
    nextObservationAt(desc({ lastObservedAt: null }), NOW) === NOW);

  // ── 3. CERO DUPLICADOS ──
  console.log("\n## 3. Cero duplicados");
  const again = scheduler.planFromWatcher(watcher.registry);
  check("replanificar NO crea tareas nuevas (se conserva la activa por torneo)",
    again.created === 0 && again.kept === 3 && again.plan.tasks.length === 3 &&
    auditScheduler(scheduler.registry).length === 0);

  // ── 4. COLA + REINTENTOS + CANCELACIONES ──
  console.log("\n## 4. Cola, reintentos y cancelaciones");
  const clock = steppableClock(NOW);
  const q = new SchedulerEngine(clock);
  q.plan([
    desc({ tournamentId: "rapido", status: "ongoing", lastObservedAt: null }),
    desc({ tournamentId: "lento", status: "finished", lastObservedAt: NOW }),
  ]);
  const taken = q.take();
  check("take entrega SOLO lo vencido (dueAt ≤ now) y lo marca running",
    taken.length === 1 && taken[0].tournamentId === "rapido" && taken[0].state === "running" && taken[0].attempt === 1);
  q.fail(taken[0].id, "sin red");
  const retry1 = q.registry.tasks[taken[0].id];
  check("fallo → reintento planificado con backoff base (1 min)",
    retry1.state === "retryable" && retry1.dueAt === clock() + DEFAULT_POLICY.retry.baseDelayMs);
  clock.advance(DEFAULT_POLICY.retry.baseDelayMs);
  q.take();
  q.fail(taken[0].id, "sin red");
  const retry2 = q.registry.tasks[taken[0].id];
  check("segundo fallo → backoff exponencial (2 min)",
    retry2.state === "retryable" && retry2.dueAt === clock() + DEFAULT_POLICY.retry.baseDelayMs * 2);
  clock.advance(DEFAULT_POLICY.retry.baseDelayMs * 2);
  q.take();
  q.fail(taken[0].id, "sin red");
  check("máximo de intentos → CANCELADA (planificado, nunca ejecutado)",
    q.registry.tasks[taken[0].id].state === "cancelled" && q.registry.tasks[taken[0].id].attempt === DEFAULT_POLICY.retry.maxAttempts);
  const lentoId = q.registry.order.find((id: string) => id.startsWith("lento"))!;
  q.cancel(lentoId, "temporada cerrada");
  check("cancelación explícita", q.registry.tasks[lentoId].state === "cancelled" &&
    q.registry.tasks[lentoId].reason === "temporada cerrada");
  check("completar cierra el ciclo", (() => {
    const c2 = steppableClock(NOW);
    const e2 = new SchedulerEngine(c2);
    e2.plan([desc({ tournamentId: "ok", lastObservedAt: null })]);
    const [t] = e2.take();
    e2.complete(t.id);
    return e2.registry.tasks[t.id].state === "completed" && schedulerMetrics(e2.registry).completed === 1;
  })());

  // ── 5. RELOJ INYECTABLE ──
  console.log("\n## 5. Reloj inyectable");
  const srcDir = join(process.cwd(), "src", "tournament-scheduler");
  const sources = readdirSync(srcDir).map((f) => readFileSync(join(srcDir, f), "utf8")).join("\n");
  check("el módulo JAMÁS llama a Date.now (reloj siempre inyectado)", !sources.includes("Date.now"));
  check("dos relojes fijos distintos ⇒ planes coherentes con SU tiempo", (() => {
    const eA = new SchedulerEngine(fixedClock(1000));
    const eB = new SchedulerEngine(fixedClock(2000));
    const d = [desc({ tournamentId: "x", lastObservedAt: null })];
    return eA.plan(d).plan.nextDueAt === 1000 && eB.plan(d).plan.nextDueAt === 2000;
  })());

  // ── 6. DETERMINISMO ──
  console.log("\n## 6. Determinismo");
  const replay = (): string => {
    const e = new SchedulerEngine(fixedClock(NOW));
    e.planFromWatcher(watcher.registry);
    return JSON.stringify(e.registry);
  };
  check("misma entrada + mismo reloj ⇒ registry byte a byte", replay() === replay());
  check("huella del plan estable", scheduler.planFromWatcher(watcher.registry).plan.fingerprint ===
    scheduler.planFromWatcher(watcher.registry).plan.fingerprint);

  // ── 7. MÚLTIPLES TORNEOS + RENDIMIENTO ──
  console.log("\n## 7. Múltiples torneos y rendimiento");
  const many = Array.from({ length: 500 }, (_, i) => desc({
    tournamentId: `t${String(i).padStart(3, "0")}`,
    status: (["ongoing", "upcoming", "finished", "archived"] as const)[i % 4],
    live: i % 10 === 0,
    lastObservedAt: i % 7 === 0 ? null : NOW - (i % 5) * MIN,
  }));
  const big = new SchedulerEngine(fixedClock(NOW));
  const t0 = Date.now();
  const bigPlan = big.plan(many);
  const taken2 = big.take();
  const ms = Date.now() - t0;
  const bm = schedulerMetrics(big.registry);
  check("500 torneos planificados sin duplicados y con cola coherente",
    bigPlan.created === 500 && bm.tournaments === 500 && auditScheduler(big.registry).length === 0 &&
    taken2.length > 0 && dueTasks(big.registry, NOW).length === 0, `${ms} ms · vencidas ${taken2.length}`);
  check("rendimiento razonable", ms < 2000, `${ms} ms`);

  // ── 8. CERO EJECUCIÓN ──
  console.log("\n## 8. Cero ejecución del Watch Engine (ni de ningún motor)");
  check("watcher intacto tras TODA la planificación", JSON.stringify(watcher.registry) === watcherJson);
  check("runtime del juego intacto", totalCards() === cardsBefore && runtimeVersion() === 0);
  check("el módulo no importa Orchestrator/Publisher/Control (solo tipos del Watcher)",
    !sources.includes("tournament-orchestrator") && !sources.includes("@/publisher") &&
    !sources.includes("tournament-control") && !sources.includes("runTournamentPipeline"));

  console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main();
