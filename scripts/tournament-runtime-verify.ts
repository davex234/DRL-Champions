/**
 * VERIFICACIÓN DEL TOURNAMENT RUNTIME SERVICE (Tournament Watcher · Fase 5/5, FINAL).
 *
 * SOLO coordina Scheduler → Watcher → Auto Pipeline → Notification Hub. Ejemplo
 * obligatorio: runtime iniciado → plan → TeamEliminated(Heretics) → GenerateReview →
 * "nueva revisión pendiente" → dormir — sin Tournament Control, sin publicar, sin Telegram
 * real. Comprueba: loop · orden exacto · lock (instancia única + restart) · shutdown ·
 * health · métricas · determinismo · rendimiento · integración con los 4 módulos · cero
 * ejecuciones/publicaciones/aprobaciones.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { RawSnapshot } from "@/importer";
import { resetRuntime, runtimeVersion, runtimeGenerationId } from "@/publisher";
import { totalCards } from "@/data/catalog";
import {
  createTournamentRuntime, InMemoryLock, type SnapshotSource,
} from "@/tournament-runtime";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const T = "valorant-masters-london-2026";

const snap = (id: string, eliminated: boolean): RawSnapshot => ({
  tournament: { id, name: "Valorant Masters London 2026", type: "international", tier: "vct-international", status: "ongoing", startDate: "2026-06-05T00:00:00Z" },
  stages: [{ id: "s1", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
  teams: [{ id: "a", name: "London Lions" }, { id: "b", name: "Team Heretics" }],
  players: [{ id: "p1", nick: "zekken", team: "London Lions" }],
  coaches: [],
  matches: [{ id: `${id}-m1`, stageId: "s1", teamA: "London Lions", teamB: "Team Heretics", status: eliminated ? "finished" : "live", format: "bo3", scoreA: eliminated ? 2 : 1, scoreB: 1, winner: eliminated ? "London Lions" : undefined, round: "Semifinal", matchOrder: 1 }],
  maps: [],
  mapStats: [],
  standings: [
    { team: "London Lions", position: 1, wins: 1, losses: 0, status: eliminated ? "qualified" : undefined },
    { team: "Team Heretics", position: 2, wins: 0, losses: eliminated ? 1 : 0, status: eliminated ? "eliminated" : undefined },
  ],
  awards: {},
});

interface DemoWorld { now: number; eliminated: boolean }

function makeRuntime(world: DemoWorld, owner: string, lock = new InMemoryLock(), resume?: Parameters<typeof createTournamentRuntime>[0]["resume"]) {
  const source: SnapshotSource = (tid) => (tid === T ? snap(T, world.eliminated) : null);
  return createTournamentRuntime({
    config: { lockKey: "watch-queue", owner, sleepMs: 2 * MIN, watchlist: [T] },
    source,
    clock: () => world.now,
    sleeper: async (ms) => { world.now += ms; }, // dormir = avanzar el reloj lógico
    lock,
    resume,
  });
}

async function main(): Promise<void> {
  console.log("# Verificación del Tournament Runtime Service — DRL Champions (Watcher Fase 5/5)\n");

  resetRuntime();
  const cardsBefore = totalCards();

  // ── 1. EJEMPLO OBLIGATORIO (loop completo) ──
  console.log("## 1. Ejemplo obligatorio — loop completo");
  const world: DemoWorld = { now: NOW, eliminated: false };
  const lock = new InMemoryLock();
  const { runtime, deps, adapters } = makeRuntime(world, "runtime-A", lock);
  check("runtime iniciado (lock adquirido)", runtime.start() && runtime.state.status === "running");

  const [it1] = await runtime.run(1);          // observa A (torneo nuevo; sin peticiones)
  world.eliminated = true;                      // el mundo cambia mientras duerme
  const [it2] = await runtime.run(1);           // observa B: Heretics eliminado

  console.log(`   it1: eventos=${it1.events} requests=${it1.requests} · it2: eventos=${it2.events} requests=${it2.requests} mensajes=${it2.messages}`);
  check("iteración 1: el scheduler planifica y el watcher descubre el torneo",
    it1.planned === 1 && it1.taken === 1 && it1.observed === 1 && it1.events >= 1 && it1.requests === 0);
  check("iteración 2: Watcher detecta TeamEliminated(Heretics)",
    it2.events >= 2 && deps.watcher.registry.tournaments[T].history.some((e) => e.kind === "team-eliminated" && e.subject === "Team Heretics"));
  check("Coordinator genera GenerateReview (motivo TeamEliminated)",
    it2.requests === 1 && deps.coordinator.registry.order.length === 1 &&
    Object.values(deps.coordinator.registry.requests)[0].action === "generate-review" &&
    Object.values(deps.coordinator.registry.requests)[0].reason === "TeamEliminated");
  check("Notification Hub genera 'nueva revisión pendiente' (al adaptador, sin Telegram real)",
    it2.messages >= 1 && it2.sent >= 1 &&
    adapters.telegram.outbox.some((e) => e.kind === "send" && (e as { text: string }).text.includes("nueva revisión pendiente")));
  check("el runtime vuelve a DORMIR", runtime.state.status === "sleeping" && it2.stages[it2.stages.length - 1] === "sleep");
  check("sin Tournament Control, sin publicar (runtime del juego intacto)",
    totalCards() === cardsBefore && runtimeVersion() === 0 && runtimeGenerationId() === "");

  // ── 2. ORDEN EXACTO ──
  console.log("\n## 2. Orden exacto del loop");
  check("Scheduler → take → Watcher → Auto Pipeline → Notifications → dormir",
    it2.stages[0] === "scheduler:plan" && it2.stages[1] === "scheduler:take" &&
    it2.stages[2] === `watcher:observe:${T}` && it2.stages[3] === "autopipeline:ingest" &&
    it2.stages[4] === "notifications:plan" && it2.stages[5] === "notifications:dispatch" &&
    it2.stages[6] === "sleep");
  check("todas las iteraciones respetan el MISMO orden",
    runtime.reports.every((r) => r.stages[0] === "scheduler:plan" && r.stages[r.stages.length - 1] === "sleep"));

  // ── 3. LOCK (un único runtime activo) ──
  console.log("\n## 3. Lock");
  const second = makeRuntime(world, "runtime-B", lock);
  check("el SEGUNDO runtime termina inmediatamente con estado controlado",
    second.runtime.start() === false && second.runtime.state.status === "lock-denied" &&
    second.runtime.tick() === null);
  check("el lock sigue siendo del primero", lock.ownerOf("watch-queue") === "runtime-A" && runtime.health().lockHeld);

  // ── 4. SHUTDOWN LIMPIO + RESTART ──
  console.log("\n## 4. Shutdown y restart");
  deps.hub.plan(deps.coordinator.plan(), {}); // deja algo pendiente… (dedupe lo evita) →
  const histBefore = {
    watcher: deps.watcher.registry.tournaments[T].history.length,
    coordinator: deps.coordinator.registry.history.length,
    hub: deps.hub.registry.history.length,
  };
  const down = runtime.stop();
  check("apagado limpio: lock liberado y estado stopped",
    down.lockReleased && runtime.state.status === "stopped" && lock.ownerOf("watch-queue") === null);
  check("NUNCA se pierde historial al apagar",
    deps.watcher.registry.tournaments[T].history.length === histBefore.watcher &&
    deps.coordinator.registry.history.length >= histBefore.coordinator &&
    deps.hub.registry.history.length >= histBefore.hub);
  const revived = makeRuntime(world, "runtime-C", lock, {
    watcher: deps.watcher.registry,
    scheduler: deps.scheduler.registry,
    coordinator: deps.coordinator.registry,
    hub: deps.hub.registry,
  });
  check("restart: el tercero adquiere el lock con los registries REHIDRATADOS",
    revived.runtime.start() && revived.deps.watcher.registry.tournaments[T].revision === deps.watcher.registry.tournaments[T].revision);
  const [it3] = await revived.runtime.run(1);
  check("tras el restart, sin cambios reales ⇒ cero eventos y cero duplicados",
    it3.observed === 1 && it3.events === 0 && it3.requests === 0 &&
    revived.deps.coordinator.registry.order.length === 1);
  revived.runtime.stop();

  // ── 5. HEALTH ──
  console.log("\n## 5. Health");
  const h = runtime.health();
  check("uptime · última iteración · último error · latencias por etapa · estado · lock",
    h.uptimeMs > 0 && h.lastIterationAt !== null && h.lastError === null &&
    ["schedulerMs", "watchMs", "pipelineMs", "notificationsMs"].every((k) => k in h.latencies) &&
    h.status === "stopped" && h.lockHeld === false && h.iterations === 2);
  check("un error de fuente queda registrado sin tumbar el runtime", await (async () => {
    const w2: DemoWorld = { now: NOW, eliminated: false };
    const bad = createTournamentRuntime({
      config: { lockKey: "err-queue", owner: "err", sleepMs: MIN, watchlist: [T] },
      source: () => { throw new Error("fuente rota"); },
      clock: () => w2.now,
      sleeper: async (ms) => { w2.now += ms; },
      lock: new InMemoryLock(),
    });
    bad.runtime.start();
    await bad.runtime.run(1);
    return bad.runtime.health().lastError === "fuente rota" && bad.runtime.state.status === "sleeping";
  })());

  // ── 6. MÉTRICAS ──
  console.log("\n## 6. Métricas");
  const m = runtime.metrics();
  check("agregado de los 4 módulos + iteraciones",
    m.iterations === 2 && m.tournamentsWatched === 1 && m.eventsEmitted >= 3 &&
    m.requestsTotal === 1 && m.messagesSent >= 1);

  // ── 7. DETERMINISMO ──
  console.log("\n## 7. Determinismo");
  const play = async (): Promise<string> => {
    const w: DemoWorld = { now: NOW, eliminated: false };
    const r = makeRuntime(w, "det", new InMemoryLock());
    r.runtime.start();
    await r.runtime.run(1);
    w.eliminated = true;
    await r.runtime.run(1);
    r.runtime.stop();
    return JSON.stringify({
      reports: r.runtime.reports.map((x) => ({ ...x, latencies: undefined })),
      watcher: r.deps.watcher.registry,
      coordinator: r.deps.coordinator.registry,
      hub: r.deps.hub.registry,
    });
  };
  check("misma secuencia ⇒ mismos informes y registries byte a byte", (await play()) === (await play()));

  // ── 8. RENDIMIENTO ──
  console.log("\n## 8. Rendimiento");
  const wPerf: DemoWorld = { now: NOW, eliminated: false };
  const perf = createTournamentRuntime({
    config: { lockKey: "perf-queue", owner: "perf", sleepMs: MIN },
    source: (tid) => snap(tid, false),
    clock: () => wPerf.now,
    sleeper: async (ms) => { wPerf.now += ms; },
    lock: new InMemoryLock(),
  });
  perf.runtime.start();
  for (let i = 0; i < 20; i++) perf.deps.watcher.observe(snap(`torneo-${i}`, false), { at: wPerf.now });
  const t0 = Date.now();
  await perf.runtime.run(50);
  const ms = Date.now() - t0;
  check("50 iteraciones × 20 torneos en tiempo razonable",
    perf.runtime.state.iterations === 50 && ms < 5000, `${ms} ms`);
  perf.runtime.stop();

  // ── 9. CERO EJECUCIONES ──
  console.log("\n## 9. Cero ejecuciones de motores de negocio");
  const srcDir = join(process.cwd(), "src", "tournament-runtime");
  const sources = readdirSync(srcDir).map((f) => readFileSync(join(srcDir, f), "utf8")).join("\n");
  check("el módulo solo importa los 4 módulos de vigilancia (jamás motores de negocio)",
    !sources.includes("tournament-orchestrator") && !sources.includes("tournament-control") &&
    !sources.includes("@/publisher") && !sources.includes("@/editorial") &&
    !sources.includes("runTournamentPipeline") && !sources.includes("publishRecord") &&
    !sources.includes("fetch("));
  check("cero publicaciones/aprobaciones tras TODO el tráfico",
    totalCards() === cardsBefore && runtimeVersion() === 0);

  console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
