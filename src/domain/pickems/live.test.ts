/**
 * PICK'EMS · EL EVENTO VIVO (Fase 24.5) — pruebas puras del dominio.
 *
 * Fixtures MÍNIMOS y etiquetados (QA SYNTHETIC). Lo que protegen: que «en directo» salga
 * solo del `status` real, que el siguiente partido, «hoy» y lo reciente se ordenen bien, que
 * el progreso cuente partidos reales, que el diff detecte transiciones reales (y solo esas),
 * que la deduplicación por sesión funcione y que el ritmo de refresco nunca sea por segundo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildBracketModel, type BracketMatchInput, type StageLike } from "./bracket";
import {
  deriveLiveEventSnapshot, diffLiveSnapshots, dedupeChanges, changedIdsOf, refreshIntervalFor,
  tournamentStatus, isUrgent, agoLabel, dayKey, LIVE_POLL_MS, URGENT_LOCK_MS, type LiveInput,
} from "./live";
import type { AnswerMap } from "./progress";

const NOW = Date.parse("2026-09-27T14:00:00Z");
const at = (h: number) => new Date(NOW + h * 3600_000).toISOString();
const C = { progression_evidence: "SOURCE_STRUCTURED_HTML", progression_confidence: "CONFIRMED" } as const;
const STAGES: StageLike[] = [{ id: "st-g", name: "Group Stage", kind: "group", order_idx: 0 }, { id: "st-po", name: "Playoffs", kind: "playoff", order_idx: 1 }];
const m = (id: string, over: Partial<BracketMatchInput> = {}): BracketMatchInput => ({
  id, stage_id: "st-g", team_a: null, team_b: null, start_time: at(24), status: "upcoming", score_a: null, score_b: null, round: null, match_order: null, ...over,
});
const q = (id: string, matchId: string, over: Partial<LiveInput["questions"][number]> = {}) => ({
  id, kind: "match_winner", match_id: matchId, prompt: "¿Quién gana?", points: 15, locks_at: at(1), locked: false, correct_option: null, order_idx: 0,
  options: [{ key: "a", label: "A" }, { key: "b", label: "B" }], ...over,
});

/** Torneo GSL «activo»: un partido terminado (hace 3 h), uno en directo, uno hoy más tarde, uno mañana, Winner's TBD con clasificación. */
const active = (): BracketMatchInput[] => [
  m("o1", { team_a: "100 Thieves", team_b: "T1", round: "Opening (A)", match_order: 1, start_time: at(-3), status: "finished", score_a: 2, score_b: 0, winner_team: "100 Thieves", ...C, winner_to_match_id: "w", winner_to_slot: 1 }),
  m("o2", { team_a: "JD Gaming", team_b: "FUT Esports", round: "Opening (A)", match_order: 2, start_time: at(-1), status: "live", score_a: 1, score_b: 1, ...C, winner_to_match_id: "w", winner_to_slot: 2 }),
  m("ob1", { team_a: "Global Esports", team_b: "Team Vitality", round: "Opening (B)", match_order: 3, start_time: at(3) }),
  m("ob2", { team_a: "Paper Rex", team_b: "Fnatic", round: "Opening (B)", match_order: 4, start_time: at(30) }),
  m("w", { team_a: "100 Thieves", round: "Winner's (A)", start_time: at(48), ...C, winner_qualifies: "qualified:groupa:winners", winner_qualifies_label: "Qualified" }),
];
const questions = () => [
  q("q1", "o1", { locked: true, locks_at: at(-3), correct_option: "a" }),
  q("q2", "o2", { locked: true, locks_at: at(-1) }),
  q("q3", "ob1", { locks_at: at(3) }),
  q("q4", "ob2", { locks_at: at(30) }),
];
const answers = (): AnswerMap => ({ q1: { option: "a", isCorrect: true, pointsAward: 15 }, q2: { option: "b", isCorrect: null, pointsAward: null } });

function snap(matches: BracketMatchInput[], over: Partial<LiveInput> = {}) {
  const model = buildBracketModel({ stages: STAGES, matches, questions: over.questions ?? questions(), answers: over.answers ?? answers(), now: NOW });
  return deriveLiveEventSnapshot({
    model, stages: STAGES, event: { status: "live" }, questions: questions(), answers: answers(),
    score: { points: 15, correct: 1, total: 1 }, ranking: [{ user_id: "u1" }, { user_id: "me" }], reward: null, userId: "me", now: NOW, ...over,
  });
}

/* ─────────────── 1-3 · ESTADO ─────────────── */

test("1-3 · estado del evento por sus partidos reales: upcoming / live / finished; sin partidos, el del origen", () => {
  assert.equal(tournamentStatus([{ status: "upcoming", start_time: at(24) }], {}, NOW), "upcoming");
  assert.equal(tournamentStatus([{ status: "upcoming", start_time: at(-1) }], {}, NOW), "live", "la hora ya pasó: en curso aunque el origen no lo haya marcado");
  assert.equal(tournamentStatus([{ status: "finished" }, { status: "upcoming", start_time: at(24) }], {}, NOW), "live");
  assert.equal(tournamentStatus([{ status: "finished" }, { status: "completed" }], {}, NOW), "finished");
  assert.equal(tournamentStatus([], { eventStatus: "finished" }, NOW), "finished");
  assert.equal(tournamentStatus([], { eventStatus: null, phase: "proximo" }, NOW), "upcoming");
  assert.equal(snap(active()).statusLabel, "En curso");
});

/* ─────────────── 4-7 · EN DIRECTO Y SIGUIENTE ─────────────── */

test("4-6 · en directo SOLO si el backend lo dice; uno, varios o ninguno", () => {
  const one = snap(active());
  assert.deepEqual(one.liveMatches.map((x) => x.id), ["o2"]);
  assert.equal(one.liveMatches[0].scoreA, 1);
  const two = snap(active().map((x) => x.id === "ob1" ? { ...x, status: "live" } : x));
  assert.equal(two.liveMatches.length, 2);
  const none = snap(active().map((x) => x.id === "o2" ? { ...x, status: "upcoming" } : x));
  assert.equal(none.liveMatches.length, 0, "sin `status: live` no se inventa un directo");
});

test("7 · el siguiente partido es el próximo por hora (no el TBD lejano), con su pregunta y su cierre", () => {
  const s = snap(active());
  assert.equal(s.nextMatches[0].id, "ob1");
  assert.equal(s.nextMatches[0].questionId, "q3");
  assert.equal(s.nextMatches[0].pickState, "pendiente");
  assert.equal(s.nextMatches[0].lockInMs, 3 * 3600_000);
  assert.equal(s.stageLabel, "Group Stage", "la fase actual es la del partido en directo / siguiente");
});

/* ─────────────── 8-11 · HOY, RECIENTES, PROGRESO ─────────────── */

test("8 · «hoy» usa el día LOCAL del navegador y pone el directo primero", () => {
  const s = snap(active());
  const today = dayKey(NOW);
  assert.ok(s.todayMatches.every((x) => dayKey(Date.parse(x.startsAt!)) === today));
  assert.equal(s.todayMatches[0].id, "o2", "en directo primero");
  assert.ok(!s.todayMatches.some((x) => x.id === "ob2"), "mañana no es hoy");
});

test("9 · resultados recientes: terminados, el último primero, con ganador real", () => {
  const s = snap(active());
  assert.deepEqual(s.recentMatches.map((x) => x.id), ["o1"]);
  assert.equal(s.recentMatches[0].winner, "a");
  const acts = s.activity.map((a) => a.kind);
  assert.ok(acts.includes("MATCH_FINISHED") && acts.includes("PREDICTION_RESOLVED"));
  const pick = s.activity.find((a) => a.kind === "PREDICTION_RESOLVED")!;
  assert.equal(pick.outcome, "acertada"); assert.equal(pick.points, 15, "puntos del corrector");
  assert.equal(pick.at, at(-3), "la única hora que existe: la del partido");
});

test("10-11 · progreso del torneo y por fase, derivado de partidos reales", () => {
  const s = snap(active());
  assert.deepEqual([s.progress.total, s.progress.finished, s.progress.live, s.progress.upcoming, s.progress.pct], [5, 1, 1, 3, 20]);
  const g = s.progress.stages.find((x) => x.id === "st-g")!;
  assert.deepEqual([g.name, g.total, g.finished], ["Group Stage", 5, 1]);
});

/* ─────────────── 12-16 · DIFF ─────────────── */

test("12-13 · clasificado TBD → equipo y participante TBD → equipo se detectan como cambios", () => {
  const before = snap(active());
  const after = snap(active().map((x) =>
    x.id === "w" ? { ...x, team_b: "FUT Esports", status: "finished", score_a: 2, score_b: 1, winner_team: "100 Thieves", start_time: at(-0.5) } : x));
  const d = diffLiveSnapshots(before, after);
  assert.ok(d.some((c) => c.kind === "QUALIFIED" && c.team === "100 Thieves"));
  assert.ok(d.some((c) => c.kind === "PARTICIPANT_SET" && c.matchId === "w" && c.slot === "b" && c.team === "FUT Esports"));
  assert.ok(d.some((c) => c.kind === "MATCH_FINISHED" && c.matchId === "w" && c.winner === "100 Thieves"));
  assert.ok(changedIdsOf(d).has("w") && changedIdsOf(d).has("qual:qualified:groupa:winners"));
});

test("14-16 · una predicción bloqueada pasa a acertada (+N del corrector) o fallada (+0) cuando el servidor lo escribe", () => {
  const before = snap(active());
  const hitQs = questions().map((x) => x.id === "q2" ? { ...x, correct_option: "b" } : x);
  const hitAns: AnswerMap = { ...answers(), q2: { option: "b", isCorrect: true, pointsAward: 15 } };
  const hit = snap(active().map((x) => x.id === "o2" ? { ...x, status: "finished", winner_team: "FUT Esports", score_b: 2 } : x), { questions: hitQs, answers: hitAns });
  const dh = diffLiveSnapshots(before, hit);
  const r = dh.find((c) => c.kind === "PREDICTION_RESOLVED")!;
  assert.deepEqual([r.kind === "PREDICTION_RESOLVED" && r.outcome, r.kind === "PREDICTION_RESOLVED" && r.points], ["acertada", 15]);
  const missAns: AnswerMap = { ...answers(), q2: { option: "b", isCorrect: false, pointsAward: 0 } };
  const miss = snap(active().map((x) => x.id === "o2" ? { ...x, status: "finished", winner_team: "JD Gaming", score_a: 2 } : x), { questions: hitQs.map((x) => x.id === "q2" ? { ...x, correct_option: "a" } : x), answers: missAns });
  const dm = diffLiveSnapshots(before, miss).find((c) => c.kind === "PREDICTION_RESOLVED")!;
  assert.deepEqual([dm.kind === "PREDICTION_RESOLVED" && dm.outcome, dm.kind === "PREDICTION_RESOLVED" && dm.points], ["fallada", 0]);
  assert.equal(diffLiveSnapshots(hit, hit).length, 0, "lo que ya estaba no se anuncia");
});

/* ─────────────── 17-20 · RANKING, PUNTOS, RECOMPENSA ─────────────── */

test("17-19 · posición y puntos vienen del servidor: sin cambio no hay aviso; con cambio, de → a", () => {
  const before = snap(active());
  const same = snap(active());
  assert.equal(diffLiveSnapshots(before, same).length, 0);
  const moved = snap(active(), { ranking: [{ user_id: "me" }, { user_id: "u1" }], score: { points: 115, correct: 2, total: 2 } });
  const d = diffLiveSnapshots(before, moved);
  assert.deepEqual(d.find((c) => c.kind === "RANK_CHANGED"), { id: "rank:2>1", kind: "RANK_CHANGED", from: 2, to: 1 });
  assert.deepEqual(d.find((c) => c.kind === "POINTS_CHANGED"), { id: "points:15>115", kind: "POINTS_CHANGED", from: 15, to: 115 });
  assert.equal(diffLiveSnapshots(null, moved).length, 0, "sin snapshot previo no hay nada que comparar");
});

test("20 · recompensa recién concedida (asiento real) → REWARD_EARNED una vez", () => {
  const before = snap(active());
  const after = snap(active(), { reward: { reason: "pickem_reward:acertante", created_at: at(-0.2) } });
  const d = diffLiveSnapshots(before, after);
  assert.deepEqual(d.find((c) => c.kind === "REWARD_EARNED"), { id: "reward:acertante", kind: "REWARD_EARNED", tier: "acertante" });
  assert.ok(after.activity.some((a) => a.kind === "REWARD_EARNED" && a.at === at(-0.2)));
  assert.equal(diffLiveSnapshots(after, after).length, 0);
});

/* ─────────────── 26-29 · RITMO Y DEDUPLICACIÓN ─────────────── */

test("26 · el ritmo nunca es por segundo: en directo 20 s, en curso 45 s, futuro 2 min, terminado 5 min", () => {
  const base = { visibility: "visible" as const, online: true, failures: 0 };
  assert.equal(refreshIntervalFor({ ...base, status: "live", hasLive: true }), LIVE_POLL_MS.live);
  assert.equal(refreshIntervalFor({ ...base, status: "live", hasLive: false }), LIVE_POLL_MS.active);
  assert.equal(refreshIntervalFor({ ...base, status: "upcoming", hasLive: false }), LIVE_POLL_MS.upcoming);
  assert.equal(refreshIntervalFor({ ...base, status: "finished", hasLive: false }), LIVE_POLL_MS.finished);
  for (const v of Object.values(LIVE_POLL_MS)) assert.ok(v >= 20_000);
});

test("24-25 · pestaña oculta o sin red: no se sondea; con fallos, retroceso creciente", () => {
  assert.equal(refreshIntervalFor({ status: "live", hasLive: true, visibility: "hidden", online: true, failures: 0 }), null);
  assert.equal(refreshIntervalFor({ status: "live", hasLive: true, visibility: "visible", online: false, failures: 0 }), null);
  const f1 = refreshIntervalFor({ status: "live", hasLive: true, visibility: "visible", online: true, failures: 1 })!;
  const f3 = refreshIntervalFor({ status: "live", hasLive: true, visibility: "visible", online: true, failures: 3 })!;
  assert.ok(f1 >= 5_000 && f3 > f1);
});

test("28-29 · deduplicación por sesión: el mismo resultado o recompensa no se anuncia dos veces", () => {
  const seen = new Set<string>();
  const before = snap(active());
  const after = snap(active(), { reward: { reason: "pickem_reward:acertante", created_at: at(-0.2) }, ranking: [{ user_id: "me" }] });
  const first = dedupeChanges(diffLiveSnapshots(before, after), seen);
  assert.ok(first.length >= 2);
  const again = dedupeChanges(diffLiveSnapshots(before, after), seen);
  assert.equal(again.length, 0);
});

/* ─────────────── URGENCIA Y ETIQUETAS ─────────────── */

test("urgencia: umbral único en el dominio; «hace N min» sin segundos", () => {
  assert.equal(URGENT_LOCK_MS, 30 * 60_000);
  assert.ok(isUrgent(new Date(NOW + 12 * 60_000).toISOString(), NOW));
  assert.ok(!isUrgent(new Date(NOW + 2 * 3600_000).toISOString(), NOW));
  assert.ok(!isUrgent(new Date(NOW - 1000).toISOString(), NOW), "ya cerrada no es urgente");
  assert.equal(agoLabel(NOW - 30_000, NOW), "hace un momento");
  assert.equal(agoLabel(NOW - 2 * 60_000, NOW), "hace 2 min");
  assert.equal(agoLabel(NOW - 3 * 3600_000, NOW), "hace 3 h");
});

/* ─────────────── 35-40 · CUADRO EN VIVO (dominio) ─────────────── */

test("35-38 · tras el resultado la arista estructural permanece, el TBD se resuelve, el marcador y el ganador son los del backend", () => {
  const before = buildBracketModel({ stages: STAGES, matches: active(), questions: questions(), answers: answers(), now: NOW });
  const after = buildBracketModel({ stages: STAGES, matches: active().map((x) => x.id === "o2" ? { ...x, status: "finished", score_a: 1, score_b: 2, winner_team: "FUT Esports" } : x.id === "w" ? { ...x, team_b: "FUT Esports" } : x), questions: questions(), answers: answers(), now: NOW });
  assert.deepEqual(before.edges.filter((e) => e.from === "o2"), after.edges.filter((e) => e.from === "o2"), "la estructura no cambia");
  assert.equal(after.matches.w.teamB?.name, "FUT Esports");
  assert.equal(after.matches.o2.winner, "b"); assert.equal(after.matches.o2.scoreB, 2);
  assert.equal(after.conflicts.length, 0);
});

test("43-44 · liga: sin cuadro ni aristas, pero con evento vivo; grupos+playoffs: la fase actual es la del siguiente partido", () => {
  const league = [m("w1", { team_a: "A", team_b: "B", round: "Week 1", status: "finished", winner_team: "A", start_time: at(-2) }), m("w2", { team_a: "C", team_b: "D", round: "Week 2", start_time: at(5) })];
  const model = buildBracketModel({ stages: [STAGES[0]], matches: league, questions: [], answers: {}, now: NOW });
  assert.equal(model.format, "GROUP_STAGE"); assert.equal(model.edges.length, 0);
  const s = deriveLiveEventSnapshot({ model, stages: STAGES, event: null, questions: [], answers: {}, score: null, ranking: [], reward: null, userId: null, now: NOW });
  assert.equal(s.status, "live"); assert.equal(s.nextMatches[0].id, "w2");
  const mixed = snap([...active(), m("uqf", { stage_id: "st-po", team_a: "X", team_b: "Y", round: "Upper Quarterfinal", start_time: at(100) })]);
  assert.equal(mixed.stageLabel, "Group Stage");
  const playoffs = snap([m("uqf", { stage_id: "st-po", team_a: "X", team_b: "Y", round: "Upper Quarterfinal", start_time: at(2) }), m("g", { status: "finished", team_a: "A", team_b: "B", winner_team: "A", round: "Opening (A)", start_time: at(-50) })]);
  assert.equal(playoffs.stageLabel, "Playoffs");
});
