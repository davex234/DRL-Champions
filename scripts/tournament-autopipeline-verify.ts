/**
 * VERIFICACIÓN DEL AUTO PIPELINE COORDINATOR (Tournament Watcher · Fase 3/5).
 *
 * SOLO coordina: WatchEvents → política declarativa → dedupe → PipelineRequests. Ejemplo
 * obligatorio: TeamEliminated(Heretics) + 2×StatisticsChanged ⇒ 1 única petición
 * GenerateReview con motivo TeamEliminated — sin ejecutar el pipeline, sin publicar, sin
 * Telegram. Comprueba: routing · políticas · deduplicación · cola · historial ·
 * determinismo · rendimiento · integración con Watcher y Scheduler · compatibilidad con
 * Tournament Control · cero ejecuciones · cero publicaciones · cero modificaciones.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { RawSnapshot } from "@/importer";
import { resetRuntime, runtimeVersion, runtimeGenerationId } from "@/publisher";
import { totalCards } from "@/data/catalog";
import { WatchEngine, type WatchEvent } from "@/tournament-watcher";
import { SchedulerEngine, fixedClock } from "@/tournament-scheduler";
import {
  CoordinatorEngine, DEFAULT_DECISION_POLICY, routeEvent, coordinatorMetrics,
  historyOfRequest, auditCoordinator,
  type DecisionPolicy, type CoordinatorRegistry,
} from "@/tournament-autopipeline";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const NOW = 1_700_000_000_000;
const T = "valorant-masters-london-2026";
const ev = (seq: number, kind: WatchEvent["kind"], subject?: string, tournamentId = T): WatchEvent =>
  ({ seq, at: NOW, tournamentId, kind, subject });

function main(): void {
  console.log("# Verificación del Auto Pipeline Coordinator — DRL Champions (Watcher Fase 3/5)\n");

  resetRuntime();
  const cardsBefore = totalCards();

  // ── 1. EJEMPLO OBLIGATORIO ──
  console.log("## 1. Ejemplo obligatorio — 3 eventos ⇒ 1 PipelineRequest");
  const engine = new CoordinatorEngine(fixedClock(NOW));
  const r = engine.ingest([
    ev(1, "team-eliminated", "Team Heretics"),
    ev(2, "statistics-changed", "zekken"),
    ev(3, "statistics-changed", "Hereje"),
  ]);
  const req = engine.plan()[0];
  console.log(`   → ${req.id} · acción=${req.action} · motivo=${req.reason} · origen=[${req.sourceEventSeqs.join(",")}]`);
  check("UNA sola petición para los 3 eventos", r.created.length === 1 && r.merged === 2 && engine.plan().length === 1);
  check("acción GenerateReview con motivo TeamEliminated (el dominante)",
    req.action === "generate-review" && req.reason === "TeamEliminated" &&
    req.sourceEventSeqs.join(",") === "1,2,3");
  check("sin ejecutar pipeline, sin publicar, sin Telegram (runtime intacto)",
    totalCards() === cardsBefore && runtimeVersion() === 0 && runtimeGenerationId() === "");

  // ── 2. ROUTING + POLÍTICAS ──
  console.log("\n## 2. Routing y políticas declarativas");
  const route = (k: WatchEvent["kind"]): string => `${routeEvent(ev(9, k), DEFAULT_DECISION_POLICY).action}`;
  check("política del contrato: eliminado/stats ⇒ revisión · finished ⇒ revisión completa · match/roster ⇒ esperar",
    route("team-eliminated") === "generate-review" && route("statistics-changed") === "generate-review" &&
    route("tournament-finished") === "generate-full-review" &&
    route("match-updated") === "wait" && route("roster-changed") === "wait");
  check("evento sin regla ⇒ defaultAction (ignore)", route("prize-changed") === "ignore");
  const custom: DecisionPolicy = { rules: [{ kind: "prize-changed", action: "generate-review", reason: "Premio" }], defaultAction: "wait" };
  const custEngine = new CoordinatorEngine(fixedClock(NOW), undefined, custom);
  const custResult = custEngine.ingest([ev(1, "prize-changed"), ev(2, "team-eliminated")]);
  check("TODO configurable: otra política cambia el comportamiento (nada hardcodeado)",
    custResult.created.length === 1 && custResult.created[0].reason === "Premio" && custResult.waited === 1);
  check("el motivo dominante lo decide la PRIORIDAD de la política (orden de reglas)", (() => {
    const e2 = new CoordinatorEngine(fixedClock(NOW));
    e2.ingest([ev(1, "statistics-changed"), ev(2, "team-eliminated")]);
    return e2.plan()[0].reason === "TeamEliminated"; // llegó después pero es más prioritario
  })());

  // ── 3. DEDUPLICACIÓN (10 eventos → 1 petición) ──
  console.log("\n## 3. Deduplicación");
  const e10 = new CoordinatorEngine(fixedClock(NOW));
  const r10 = e10.ingest(Array.from({ length: 10 }, (_, i) => ev(i + 1, "statistics-changed", `p${i}`)));
  check("10 eventos del mismo torneo y motivo ⇒ 1 única petición",
    r10.received === 10 && r10.created.length === 1 && r10.merged === 9 &&
    e10.plan()[0].sourceEventSeqs.length === 10);
  check("torneos distintos ⇒ peticiones distintas; acciones distintas ⇒ peticiones distintas", (() => {
    const e2 = new CoordinatorEngine(fixedClock(NOW));
    const out = e2.ingest([ev(1, "team-eliminated"), ev(2, "team-eliminated", "x", "otro-torneo"), ev(3, "tournament-finished")]);
    return out.created.length === 3;
  })());
  check("una petición ya PLANIFICADA no absorbe eventos nuevos (se crea la siguiente)", (() => {
    const e2 = new CoordinatorEngine(fixedClock(NOW));
    e2.ingest([ev(1, "team-eliminated")]);
    e2.markPlanned(e2.plan()[0].id);
    e2.ingest([ev(2, "team-eliminated")]);
    return e2.registry.order.length === 2 && e2.registry.order[1].endsWith("#2");
  })());

  // ── 4. COLA ──
  console.log("\n## 4. Cola");
  const q = new CoordinatorEngine(fixedClock(NOW));
  q.ingest([ev(1, "team-eliminated"), ev(2, "tournament-finished")]);
  const [qa, qb] = q.plan();
  q.markPlanned(qa.id);
  q.markExecuted(qa.id);
  q.cancel(qb.id, "temporada cerrada");
  const qm = q.metrics();
  check("pendientes → planificadas → ejecutadas (SOLO registradas) · canceladas",
    qm.planned === 0 && qm.executed === 1 && qm.cancelled === 1 && qm.pending === 0);
  check("transiciones ilegales no mutan", (() => {
    const before = JSON.stringify(q.registry);
    q.markExecuted(qb.id); // cancelada: no puede ejecutarse
    q.markPlanned(qa.id);  // ejecutada: no puede volver
    return JSON.stringify(q.registry) === before;
  })());

  // ── 5. HISTORIAL ──
  console.log("\n## 5. Historial");
  const h = historyOfRequest(engine.registry, req.id);
  check("historial completo: creación + 2 fusiones, con evento origen/motivo/fecha/estado",
    h.length === 3 && h[0].kind === "request-created" && h.filter((x) => x.kind === "request-merged").length === 2 &&
    h.every((x) => x.at === NOW && !!x.reason && !!x.eventSeq));
  check("TODA decisión queda en el historial (también esperar/ignorar)", (() => {
    const e2 = new CoordinatorEngine(fixedClock(NOW));
    e2.ingest([ev(1, "match-updated"), ev(2, "prize-changed")]);
    const decisions = e2.registry.history.filter((x) => x.kind === "decision");
    return decisions.length === 2 && decisions[0].state === "wait" && decisions[1].state === "ignore";
  })());
  check("jamás se pierde: auditoría íntegra", auditCoordinator(engine.registry).length === 0 &&
    auditCoordinator(q.registry).length === 0);

  // ── 6. INTEGRACIÓN REAL: WATCHER → SCHEDULER → COORDINATOR ──
  console.log("\n## 6. Integración con Watcher y Scheduler");
  const snap = (status: string, eliminated: boolean): RawSnapshot => ({
    tournament: { id: T, name: "Masters London", type: "international", tier: "vct-international", status, startDate: "2026-06-05T00:00:00Z" },
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
  const watcher = new WatchEngine();
  watcher.observe(snap("ongoing", false), { at: NOW });
  const scheduler = new SchedulerEngine(fixedClock(NOW + 60_000));
  scheduler.planFromWatcher(watcher.registry);
  const taken = scheduler.take();                              // el scheduler ENTREGA la tarea
  const obs = watcher.observe(snap("ongoing", true), { at: NOW + 60_000 }); // la observación (Watcher F1)
  scheduler.complete(taken[0].id);
  const chain = new CoordinatorEngine(fixedClock(NOW + 60_000));
  const chainResult = chain.ingest(obs.events);                // el coordinador SOLO coordina
  check("cadena completa scheduler→watcher→coordinator produce la petición correcta",
    taken.length === 1 && chainResult.created.length === 1 &&
    chain.plan()[0].action === "generate-review" && chain.plan()[0].reason === "TeamEliminated");
  check("compatibilidad con Tournament Control: la petición lleva lo que su API pública necesita",
    typeof chain.plan()[0].tournamentId === "string" && chain.plan()[0].tournamentId === T &&
    ["generate-review", "generate-full-review"].includes(chain.plan()[0].action));

  // ── 7. DETERMINISMO ──
  console.log("\n## 7. Determinismo");
  const replay = (): string => {
    const e = new CoordinatorEngine(fixedClock(NOW));
    e.ingest([ev(1, "team-eliminated", "Team Heretics"), ev(2, "statistics-changed"), ev(3, "match-updated")]);
    return JSON.stringify(e.registry);
  };
  check("misma entrada + mismo reloj ⇒ registry byte a byte", replay() === replay());
  check("registry 100% serializable", (() => {
    const j = JSON.parse(JSON.stringify(engine.registry)) as CoordinatorRegistry;
    return j.order.length === engine.registry.order.length && j.history.length === engine.registry.history.length;
  })());

  // ── 8. RENDIMIENTO ──
  console.log("\n## 8. Rendimiento");
  const big = new CoordinatorEngine(fixedClock(NOW));
  const bigEvents: WatchEvent[] = Array.from({ length: 1000 }, (_, i) =>
    ev(i + 1, i % 3 === 0 ? "statistics-changed" : i % 3 === 1 ? "match-updated" : "team-eliminated", `s${i}`, `torneo-${i % 20}`));
  const t0 = Date.now();
  const bigResult = big.ingest(bigEvents);
  const ms = Date.now() - t0;
  check("1000 eventos → 20 peticiones (dedupe por torneo) en tiempo razonable",
    bigResult.created.length === 20 && bigResult.merged > 500 && ms < 2000,
    `${ms} ms · fusionados ${bigResult.merged}`);

  // ── 9. CERO EJECUCIONES / CERO MODIFICACIONES ──
  console.log("\n## 9. Cero ejecuciones reales");
  const srcDir = join(process.cwd(), "src", "tournament-autopipeline");
  const sources = readdirSync(srcDir).map((f) => readFileSync(join(srcDir, f), "utf8")).join("\n");
  check("el módulo no importa Orchestrator/Control/Publisher/Editorial (ni sus funciones)",
    !sources.includes("tournament-orchestrator") && !sources.includes("tournament-control") &&
    !sources.includes("@/publisher") && !sources.includes("@/editorial") &&
    !sources.includes("runTournamentPipeline") && !sources.includes("publishRecord"));
  check("cero publicaciones y cero modificaciones del juego tras TODO el tráfico",
    totalCards() === cardsBefore && runtimeVersion() === 0);
  check("las acciones planificables JAMÁS incluyen aprobar/publicar",
    DEFAULT_DECISION_POLICY.rules.every((r) => ["generate-review", "generate-full-review", "wait", "ignore"].includes(r.action)));

  console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main();
