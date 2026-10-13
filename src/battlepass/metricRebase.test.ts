/**
 * FASE 36.1 · CONTADOR DE SOBRES — versión de la fuente, progreso y rebase conservador (puro).
 *
 * Una baseline de la fuente antigua nunca se mide contra la nueva; el rebase conserva el progreso visible y solo
 * cuentan las aperturas posteriores; nada caducado se revive; nada reclamado se toca; nada se concede.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  METRIC_VERSIONS, legacyMetricKey, isLegacyBaseline, metricValue, missionProgress, assignMission, rebaselineForRepeat,
} from "./missions";
import { rebaseMission, rebaseState, legacyProgress } from "./metricRebase";
import { PassEngine, freshPassState } from "@/battlepass";
import { CURRENT_SEASON } from "@/data/season";
import type { ActiveMission, MissionDef } from "./types";

const H = 3600_000; const D = 24 * H;
const NOW = Date.parse("2026-09-15T17:00:00.000Z"); // martes
const TODAY = Date.parse("2026-09-15T13:21:50.200Z");
const MONDAY = Date.parse("2026-09-14T00:00:00.000Z");
const LEGACY = legacyMetricKey("packs_opened");

const m = (o: Partial<ActiveMission> = {}): ActiveMission => ({
  id: "d-abrir-1", kind: "daily", metric: "packs_opened", goal: 1, baseline: 0, claimed: false, assignedAt: TODAY, ...o,
});
const snap = (current: number, legacy = 0) => ({ packs_opened: current, [LEGACY]: legacy });
const C = (legacy: number, current: number) => ({ packs_opened: { legacy, current } });

/* ───────────── versión de la fuente ───────────── */

test("VERSIÓN · packs_opened es la única métrica versionada (v2); el resto no cambia", () => {
  assert.deepEqual({ ...METRIC_VERSIONS }, { packs_opened: 2 });
  assert.equal(isLegacyBaseline({ metric: "duels_won" }), false);
  assert.equal(isLegacyBaseline({ metric: "packs_opened" }), true);
  assert.equal(isLegacyBaseline({ metric: "packs_opened", metricVersion: 2 }), false);
});

test("MISIÓN NUEVA · nace con la fuente vigente (metricVersion 2) y baseline = contador real", () => {
  const def = CURRENT_SEASON.missionPool.find((d) => d.id === "d-abrir-1")!;
  const a = assignMission(def, snap(7, 0), NOW);
  assert.equal(a.metricVersion, 2);
  assert.equal(a.baseline, 7);
  const other = assignMission(CURRENT_SEASON.missionPool.find((d) => d.metric === "duels_won")!, { duels_won: 3 }, NOW);
  assert.equal(other.metricVersion, undefined, "las métricas sin cambio de fuente no llevan versión");
});

test("LEGACY · una baseline antigua se mide con la fuente antigua, nunca con la nueva (sin salto)", () => {
  const legacy = m({ goal: 10, baseline: 0 });
  assert.equal(metricValue(legacy, snap(5, 0)), 0);
  assert.equal(missionProgress(legacy, snap(5, 0)), 0, "5 aperturas reales anteriores no completan nada");
  assert.equal(missionProgress(legacy, snap(500, 0)), 0);
});

test("LEGACY · sin la clave antigua en el snapshot (modo local) conserva el comportamiento de siempre", () => {
  assert.equal(missionProgress(m({ goal: 3, baseline: 1 }), { packs_opened: 3 }), 2);
});

test("VIGENTE · abrir 1 = +1; abrir 3 = +3; comprar/recibir/poseer no cambian el contador → +0", () => {
  const v2 = m({ goal: 10, baseline: 5, metricVersion: 2 });
  assert.equal(missionProgress(v2, snap(5)), 0, "tras comprar o recibir: el contador de aperturas no se mueve");
  assert.equal(missionProgress(v2, snap(6)), 1);
  assert.equal(missionProgress(v2, snap(8)), 3);
});

test("VIGENTE · nunca negativo, nunca por encima del objetivo", () => {
  const v2 = m({ goal: 3, baseline: 10, metricVersion: 2 });
  assert.equal(missionProgress(v2, snap(4)), 0);
  assert.equal(missionProgress(v2, snap(99)), 3);
});

test("REPETIBLE · reclamar reinicia desde la fuente VIGENTE y deja la versión anotada", () => {
  const legacy = m({ goal: 1, baseline: 0 });
  rebaselineForRepeat(legacy, snap(6, 0));
  assert.equal(legacy.baseline, 6);
  assert.equal(legacy.metricVersion, 2);
  const local = m({ goal: 1, baseline: 2 });
  rebaselineForRepeat(local, {});
  assert.equal(local.baseline, 3, "sin contador en el snapshot, el reinicio de siempre");
  assert.equal(local.metricVersion, undefined);
});

/* ───────────── transición (rebase) ───────────── */

test("REBASE · progreso cero: baseline = contador actual, progreso visible 0, futuras aperturas +1", () => {
  const { mission, report } = rebaseMission(m(), C(0, 5), NOW);
  assert.equal(report.outcome, "REBASED");
  assert.equal(mission.baseline, 5);
  assert.equal(mission.metricVersion, 2);
  assert.equal(missionProgress(mission, snap(5)), 0);
  assert.equal(missionProgress(mission, snap(6)), 1);
  assert.equal(report.naive, 1, "sin rebase, las 5 aperturas anteriores la habrían completado");
});

test("REBASE · parcial: conserva el progreso visible y suma solo lo posterior", () => {
  const legacy = m({ id: "w-sobres-10", kind: "weekly", goal: 10, baseline: 2, assignedAt: MONDAY + H });
  const { mission, report } = rebaseMission(legacy, C(6, 30), NOW); // visible 4 con la fuente antigua
  assert.equal(report.carried, 4);
  assert.equal(missionProgress(mission, snap(30)), 4);
  assert.equal(missionProgress(mission, snap(33)), 7);
  assert.equal(report.naive, 10, "reinterpretar habría dado 28 → 10/10");
});

test("REBASE · casi completa (9/10): sigue 9/10 y una apertura real la completa", () => {
  const legacy = m({ id: "w-sobres-10", kind: "weekly", goal: 10, baseline: 0, assignedAt: MONDAY + H });
  const { mission } = rebaseMission(legacy, C(9, 3), NOW);
  assert.equal(missionProgress(mission, snap(3)), 9);
  assert.equal(missionProgress(mission, snap(4)), 10);
});

test("REBASE · completa sin reclamar: se conserva completa (no se quita lo ganado) y no se reclama", () => {
  const legacy = m({ goal: 1, baseline: 0 });
  const { mission, report } = rebaseMission(legacy, C(1, 0), NOW);
  assert.equal(report.carried, 1);
  assert.equal(missionProgress(mission, snap(0)), 1);
  assert.equal(mission.claimed, false);
});

test("REBASE · reclamada: no se toca (la recompensa pagada no se revoca ni se reinterpreta)", () => {
  const claimed = m({ claimed: true, id: "s-algo", kind: "seasonal" });
  const r = rebaseMission(claimed, C(0, 9), NOW);
  assert.equal(r.report.outcome, "SKIPPED_CLAIMED");
  assert.strictEqual(r.mission, claimed);
});

test("REBASE · caducada (ventana anterior, reloj del servidor): no se revive ni se toca", () => {
  const old = m({ assignedAt: Date.parse("2026-09-11T18:05:35.883Z") });
  const r = rebaseMission(old, C(0, 12), NOW);
  assert.equal(r.report.outcome, "SKIPPED_EXPIRED");
  assert.equal(missionProgress(r.mission, snap(12)), 0);
});

test("REBASE · frontera diaria: asignada a las 23:59:59Z de ayer está caducada; a las 00:00:00Z de hoy, viva", () => {
  const midnight = Date.parse("2026-09-15T00:00:00.000Z");
  assert.equal(rebaseMission(m({ assignedAt: midnight - 1 }), C(0, 1), NOW).report.outcome, "SKIPPED_EXPIRED");
  assert.equal(rebaseMission(m({ assignedAt: midnight }), C(0, 1), NOW).report.outcome, "REBASED");
});

test("REBASE · frontera semanal: asignada el domingo está caducada el martes; el lunes 00:00Z sigue viva", () => {
  const w = (assignedAt: number) => m({ id: "w-sobres-10", kind: "weekly", goal: 10, assignedAt });
  assert.equal(rebaseMission(w(MONDAY - 1), C(0, 1), NOW).report.outcome, "SKIPPED_EXPIRED");
  assert.equal(rebaseMission(w(MONDAY), C(0, 1), NOW).report.outcome, "REBASED");
});

test("REBASE · idempotente: aplicar dos veces = una (ALREADY_CURRENT)", () => {
  const once = rebaseMission(m(), C(0, 5), NOW).mission;
  const twice = rebaseMission(once, C(0, 9), NOW);
  assert.equal(twice.report.outcome, "ALREADY_CURRENT");
  assert.strictEqual(twice.mission, once);
});

test("REBASE · métricas sin cambio de fuente: intactas", () => {
  const duel = m({ id: "d-duelo-win", metric: "duels_won", baseline: 3 });
  const r = rebaseMission(duel, C(0, 5), NOW);
  assert.equal(r.report.outcome, "NOT_VERSIONED");
  assert.strictEqual(r.mission, duel);
});

test("REBASE · contador nuevo MENOR que el progreso antiguo: baseline negativa, progreso conservado, nunca negativo", () => {
  const legacy = m({ id: "w-sobres-10", kind: "weekly", goal: 10, baseline: 0, assignedAt: MONDAY + H });
  const { mission } = rebaseMission(legacy, C(7, 2), NOW);
  assert.equal(mission.baseline, -5);
  assert.equal(missionProgress(mission, snap(2)), 7);
  assert.equal(missionProgress(mission, snap(3)), 8);
});

test("REBASE · contador nuevo MUY ALTO: no regala nada (progreso visible 0 → 0)", () => {
  const { mission } = rebaseMission(m({ goal: 10, id: "w-sobres-10", kind: "weekly", assignedAt: MONDAY + H }), C(0, 10_000), NOW);
  assert.equal(missionProgress(mission, snap(10_000)), 0);
});

test("REBASE · legacy por encima del objetivo: se conserva acotado al objetivo", () => {
  assert.equal(legacyProgress({ baseline: 0, goal: 3 }, 50), 3);
  assert.equal(legacyProgress({ baseline: 10, goal: 3 }, 4), 0);
});

test("REBASE · contadores inválidos abortan (no se inventa un valor)", () => {
  assert.throws(() => rebaseMission(m(), C(-1, 5), NOW));
  assert.throws(() => rebaseMission(m(), C(0, 1.5), NOW));
  assert.throws(() => rebaseMission(m(), {}, NOW));
});

test("REBASE · no toca claimed, assignedAt, goal, id ni kind; no concede nada", () => {
  const before = m({ goal: 1 });
  const { mission } = rebaseMission(before, C(0, 5), NOW);
  for (const k of ["id", "kind", "metric", "goal", "claimed", "assignedAt"] as const) assert.equal(mission[k], before[k], k);
  assert.equal(before.baseline, 0, "la entrada no se muta");
});

test("ESTADO · rebaseState solo cambia las misiones legacy vivas y deja XP, reclamos y resto igual", () => {
  const state = freshPassState(CURRENT_SEASON.id);
  state.xp = 1234; state.claimedFree = [1, 2]; state.missionsCompleted = 7;
  state.missions = [
    m(), m({ id: "w-sobres-10", kind: "weekly", goal: 10, assignedAt: MONDAY + H }),
    m({ id: "d-duelo-win", metric: "duels_won", baseline: 1 }),
    m({ id: "viejo", assignedAt: TODAY - 3 * D }),
  ];
  const r = rebaseState(state, C(0, 5), NOW);
  assert.equal(r.changed, true);
  assert.deepEqual(r.reports.map((x) => x.outcome), ["REBASED", "REBASED", "NOT_VERSIONED", "SKIPPED_EXPIRED"]);
  assert.equal(r.state.xp, 1234);
  assert.deepEqual(r.state.claimedFree, [1, 2]);
  assert.equal(r.state.missionsCompleted, 7);
  assert.equal(state.missions[0].baseline, 0, "el estado de entrada no se muta");
  const none = rebaseState(r.state, C(0, 5), NOW);
  assert.equal(none.changed, false);
  assert.strictEqual(none.state, r.state);
});

/* ───────────── motor: reclamo explícito, sin auto-reclamo ───────────── */

test("MOTOR · una misión legacy de sobres con 5 aperturas reales NO se puede reclamar (no hay regalo)", () => {
  const state = freshPassState(CURRENT_SEASON.id);
  state.missions = [m()];
  const r = new PassEngine(state, CURRENT_SEASON).completeMission("d-abrir-1", snap(5, 0), NOW);
  assert.equal(r.ok, false);
});

test("MOTOR · tras el rebase, abrir un sobre real la completa y el reclamo sigue siendo explícito y único", () => {
  const state = freshPassState(CURRENT_SEASON.id);
  state.missions = [rebaseMission(m(), C(0, 5), NOW).mission];
  const engine = new PassEngine(state, CURRENT_SEASON);
  assert.equal(engine.completeMission("d-abrir-1", snap(5), NOW).ok, false, "comprar/recibir: +0");
  const claimed = engine.completeMission("d-abrir-1", snap(6), NOW);
  assert.equal(claimed.ok, true);
  const def = CURRENT_SEASON.missionPool.find((d: MissionDef) => d.id === "d-abrir-1")!;
  assert.deepEqual(claimed.rewards[0], def.reward, "misma recompensa de siempre");
  assert.equal(engine.completeMission("d-abrir-1", snap(6), NOW).ok, false, "reclamar otra vez sin abrir otro sobre: no");
  assert.equal(engine.completeMission("d-abrir-1", snap(7), NOW).ok, false, "Fase 41 · una vez por tanda: repetible = vuelve en otra rotación");
});

test("POOL · las misiones de sobres dicen «Abre» y miden packs_opened (no se cambió el texto)", () => {
  const packs = CURRENT_SEASON.missionPool.filter((d) => d.metric === "packs_opened");
  assert.deepEqual(packs.map((d) => [d.id, d.label, d.goal]), [["d-abrir-1", "Abre un sobre", 1], ["w-sobres-10", "Abre 10 sobres", 10]]);
  assert.deepEqual(packs.map((d) => d.reward), [{ credits: 200 }, { credits: 1500 }], "recompensas intactas");
});
