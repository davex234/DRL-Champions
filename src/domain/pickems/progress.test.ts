/**
 * PICK'EMS · ESTADO, PROGRESO, FASES Y POSICIÓN (Fase 24.2) — pruebas puras.
 *
 * Protegen que la pantalla LEA lo que el corrector escribió (`is_correct`, `points_award`)
 * en vez de recalcularlo; que el progreso cuente respondidas/pendientes/bloqueadas/resueltas
 * sin inventar; que la fase salga de los datos reales; y que la posición sea el orden que
 * manda el servidor.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  stateOf, progressOf, groupQuestions, nextToLock, pointsInPlay, awardedPoints, isLockedNow,
  eventPhase, eventPhaseCoarse, positionOf, positionAmong,
  type QuestionLike, type MyAnswer,
} from "./progress";

const NOW = Date.parse("2026-03-01T12:00:00Z");
const future = (h: number) => new Date(NOW + h * 3600_000).toISOString();
const past = (h: number) => new Date(NOW - h * 3600_000).toISOString();

const q = (over: Partial<QuestionLike> = {}): QuestionLike => ({
  id: "q1", kind: "match_winner", points: 25, locks_at: future(2), locked: false,
  correct_option: null, order_idx: 0,
  options: [{ key: "a", label: "Fnatic" }, { key: "b", label: "NRG" }], ...over,
});
const open = (id: string, h = 2) => q({ id, locks_at: future(h) });
const locked = (id: string) => q({ id, locked: true, locks_at: past(1) });
const resolved = (id: string, correct = "a") => q({ id, locked: true, locks_at: past(3), correct_option: correct });
const ans = (option: string, isCorrect: boolean | null = null, pointsAward: number | null = null): MyAnswer =>
  ({ option, isCorrect, pointsAward });

/* ─────────────── ESTADOS ─────────────── */

test("los siete estados salen de lock, resultado y respuesta", () => {
  assert.equal(stateOf(open("a"), undefined), "pendiente");
  assert.equal(stateOf(open("a"), ans("a")), "elegida");
  assert.equal(stateOf(locked("a"), ans("a")), "bloqueada");
  assert.equal(stateOf(locked("a"), undefined), "sin-prediccion");
  assert.equal(stateOf(resolved("a"), ans("a", true, 25)), "acertada");
  assert.equal(stateOf(resolved("a"), ans("b", false, 0)), "fallada");
  assert.equal(stateOf(resolved("a"), undefined), "sin-participar");
});

test("ACERTADA/FALLADA se LEEN del corrector (`is_correct`), no se comparan en cliente", () => {
  // El corrector manda aunque contradiga la comparación local: es él quien escribe.
  assert.equal(stateOf(resolved("a", "a"), ans("b", true, 25)), "acertada");
  assert.equal(stateOf(resolved("a", "a"), ans("a", false, 0)), "fallada");
});

test("si el corrector aún no pasó, se lee el resultado ya publicado y los puntos quedan pendientes", () => {
  assert.equal(stateOf(resolved("a"), ans("a")), "acertada");
  assert.equal(awardedPoints(ans("a")), null, "sin points_award no se afirma cifra");
  assert.equal(awardedPoints(ans("a", true, 25)), 25);
});

test("el reloj del cliente solo apaga el botón: con `now` pasado el cierre, cuenta como cerrada", () => {
  const casiCerrada = q({ locks_at: past(0.1), locked: false });
  assert.equal(isLockedNow(casiCerrada), false, "sin now, manda el `locked` del servidor");
  assert.equal(isLockedNow(casiCerrada, NOW), true);
  assert.equal(stateOf(casiCerrada, undefined, NOW), "sin-prediccion");
});

/* ─────────────── PROGRESO ─────────────── */

test("progreso: respondidas / total, pendientes, cerradas sin responder, en juego y resueltas", () => {
  const qs = [open("o1"), open("o2"), locked("l1"), locked("l2"), resolved("r1"), resolved("r2"), resolved("r3")];
  const answers = { o1: ans("a"), l1: ans("a"), r1: ans("a", true, 25), r2: ans("b", false, 0) };
  const p = progressOf(qs, answers, NOW);
  assert.equal(p.total, 7);
  assert.equal(p.answered, 4);
  assert.equal(p.pending, 1, "o2");
  assert.equal(p.lockedUnanswered, 1, "l2");
  assert.equal(p.inPlay, 1, "l1");
  assert.equal(p.resolved, 3);
  assert.equal(p.hits, 1);
  assert.equal(p.misses, 1);
  assert.equal(p.pct, 57, "4 de 7");
});

test("sin preguntas el progreso es 0 / 0 y 0 %, no NaN", () => {
  const p = progressOf([], {}, NOW);
  assert.equal(p.total, 0); assert.equal(p.pct, 0);
});

test("los puntos en juego suman `q.points` de lo respondido sin corregir (del servidor, no una constante)", () => {
  const qs = [q({ id: "a", points: 30 }), locked("b"), resolved("c")];
  (qs[1] as QuestionLike).points = 20;
  assert.equal(pointsInPlay(qs, { a: ans("a"), b: ans("a"), c: ans("a", true, 25) }, NOW), 50);
});

/* ─────────────── AGRUPACIÓN Y SIGUIENTE CIERRE ─────────────── */

test("cada pregunta cae en exactamente un grupo, las destacadas aparte, las abiertas por cierre", () => {
  const qs = [
    open("late", 10), open("soon", 1), locked("l"), resolved("r"),
    q({ id: "champ", kind: "champion", locks_at: future(1), order_idx: -1, options: [] }),
  ];
  const g = groupQuestions(qs, NOW);
  assert.deepEqual(g.featured.map((x) => x.id), ["champ"]);
  assert.deepEqual(g.open.map((x) => x.id), ["soon", "late"]);
  assert.deepEqual(g.inPlay.map((x) => x.id), ["l"]);
  assert.deepEqual(g.resolved.map((x) => x.id), ["r"]);
  assert.equal(g.featured.length + g.open.length + g.inPlay.length + g.resolved.length, qs.length);
});

test("la siguiente en cerrar es la abierta con el cierre más cercano", () => {
  assert.equal(nextToLock([open("late", 10), open("soon", 1), locked("l")], NOW)?.id, "soon");
  assert.equal(nextToLock([locked("l")], NOW), null);
});

/* ─────────────── FASES ─────────────── */

test("fase: activo con abiertas o en juego; finalizado si el origen lo dice; próximo si no ha empezado", () => {
  const base = { status: "open", eventStatus: "upcoming", startDate: future(72), endDate: future(200) };
  assert.equal(eventPhase(base, [open("a")], NOW), "activo");
  assert.equal(eventPhase(base, [locked("a")], NOW), "activo", "en juego también es activo");
  assert.equal(eventPhase({ ...base, eventStatus: "finished" }, [resolved("a")], NOW), "finalizado");
  assert.equal(eventPhase({ ...base, status: "scored" }, [resolved("a")], NOW), "finalizado");
  assert.equal(eventPhase(base, [], NOW), "proximo", "sin preguntas y sin empezar");
  assert.equal(eventPhase({ ...base, endDate: past(1) }, [], NOW), "finalizado");
});

test("fase gruesa (sin preguntas cargadas) usa estado del origen, apertura y cierre reales", () => {
  assert.equal(eventPhaseCoarse({ status: "open", eventStatus: "finished" }, NOW), "finalizado");
  assert.equal(eventPhaseCoarse({ status: "open", eventStatus: "live" }, NOW), "activo");
  assert.equal(eventPhaseCoarse({ status: "open", eventStatus: "upcoming", opensAt: future(5), locksAt: future(50) }, NOW), "proximo");
  assert.equal(eventPhaseCoarse({ status: "open", eventStatus: "upcoming", opensAt: past(5), locksAt: future(50) }, NOW), "activo");
  assert.equal(eventPhaseCoarse({ status: "scored", eventStatus: "upcoming", opensAt: past(50), locksAt: past(5) }, NOW), "finalizado");
});

/* ─────────────── POSICIÓN ─────────────── */

test("la posición es el ORDEN que trae el servidor (índice + 1), sin reordenar", () => {
  const rows = [{ user_id: "u1" }, { user_id: "u2" }, { user_id: "me" }];
  assert.equal(positionOf(rows, "me"), 3);
  assert.equal(positionOf(rows, "nadie"), null, "sin fila, sin clasificar");
  assert.equal(positionOf(rows, null), null);
});

test("posición entre puntuaciones: uno más los que tienen MÁS puntos; sin fila propia, null", () => {
  const scores = [{ user_id: "a", points: 90 }, { user_id: "me", points: 40 }, { user_id: "b", points: 40 }, { user_id: "c", points: 10 }];
  assert.equal(positionAmong(scores, "me"), 2);
  assert.equal(positionAmong(scores, "c"), 4);
  assert.equal(positionAmong(scores, "zz"), null, "no se inventa un #0");
});
