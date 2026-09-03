/**
 * `npm run tournament:runtime` — Tournament Runtime Service (Watcher F5): demo ACOTADA del
 * loop (2 iteraciones con fuente offline London A→B) mostrando estado, scheduler, watcher,
 * pipeline, notificaciones, health y métricas. Sin Tournament Control, sin publicar, sin
 * Telegram real, sin daemon: solo coordinación.
 */
import type { RawSnapshot } from "@/importer";
import { createTournamentRuntime } from "@/tournament-runtime";

const T = "valorant-masters-london-2026";
const snap = (eliminated: boolean): RawSnapshot => ({
  tournament: { id: T, name: "Valorant Masters London 2026", type: "international", tier: "vct-international", status: "ongoing", startDate: "2026-06-05T00:00:00Z" },
  stages: [{ id: "s1", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
  teams: [{ id: "a", name: "London Lions" }, { id: "b", name: "Team Heretics" }],
  players: [{ id: "p1", nick: "zekken", team: "London Lions" }],
  coaches: [],
  matches: [{ id: "m1", stageId: "s1", teamA: "London Lions", teamB: "Team Heretics", status: eliminated ? "finished" : "live", format: "bo3", scoreA: eliminated ? 2 : 1, scoreB: 1, winner: eliminated ? "London Lions" : undefined, round: "Semifinal", matchOrder: 1 }],
  maps: [],
  mapStats: [],
  standings: [
    { team: "London Lions", position: 1, wins: 1, losses: 0, status: eliminated ? "qualified" : undefined },
    { team: "Team Heretics", position: 2, wins: 0, losses: eliminated ? 1 : 0, status: eliminated ? "eliminated" : undefined },
  ],
  awards: {},
});

async function main(): Promise<void> {
  let now = Date.now();
  let pass = 0;
  const { runtime, adapters } = createTournamentRuntime({
    config: { lockKey: "cli-demo", owner: `cli-${process.pid}`, sleepMs: 120_000, watchlist: [T] },
    source: () => (pass++ === 0 ? snap(false) : snap(true)),
    clock: () => now,
    sleeper: async (ms) => { now += ms; }, // el sueño AVANZA el reloj lógico de la demo
  });

  console.log("# Tournament Runtime — servicio de vigilancia (demo acotada, sin daemon)\n");
  const started = runtime.start();
  console.log(`  lock: ${started ? "adquirido" : "DENEGADO"} · estado: ${runtime.state.status}`);

  const reports = await runtime.run(2);
  for (const r of reports) {
    console.log(`\n  ── iteración ${r.iteration} ──`);
    console.log(`  scheduler: plan ${r.planned} · entregadas ${r.taken}`);
    console.log(`  watcher: observadas ${r.observed} · eventos ${r.events}`);
    console.log(`  pipeline: peticiones ${r.requests} (+${r.merged} fusionadas)`);
    console.log(`  notifications: mensajes ${r.messages} · al adaptador ${r.sent}`);
    console.log(`  orden: ${r.stages.join(" → ")}`);
  }

  const h = runtime.health();
  const m = runtime.metrics();
  console.log(`\n  health: estado ${h.status} · uptime ${h.uptimeMs / 1000}s · iteraciones ${h.iterations} · lock ${h.lockHeld ? "sí" : "no"} · último error: ${h.lastError ?? "—"}`);
  console.log(`  latencias: scheduler ${h.latencies.schedulerMs}ms · watch ${h.latencies.watchMs}ms · pipeline ${h.latencies.pipelineMs}ms · notifications ${h.latencies.notificationsMs}ms`);
  console.log(`  métricas: torneos ${m.tournamentsWatched} · eventos ${m.eventsEmitted} · peticiones ${m.requestsTotal} (pendientes ${m.requestsPending}) · mensajes enviados(adaptador) ${m.messagesSent}`);
  console.log(`  outbox telegram (sin transporte): ${adapters.telegram.outbox.length}`);

  const down = runtime.stop();
  console.log(`\n  shutdown limpio: drenados ${down.drainedMessages} · lock liberado: ${down.lockReleased} · estado final: ${runtime.state.status}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
