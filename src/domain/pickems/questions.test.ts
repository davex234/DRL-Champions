import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMatchQuestions, correctOptionFor, isPredictable, isResolved, pointsForRound,
  DEFAULT_QUESTION_POINTS, type MatchInput,
  buildScoreQuestions, correctScoreOptionFor, correctOptionForKind, SCORE_POINTS_MULTIPLIER,
} from "./questions";

const NOW = Date.parse("2026-03-01T12:00:00Z");
const future = (h: number) => new Date(NOW + h * 3600_000).toISOString();
const past = (h: number) => new Date(NOW - h * 3600_000).toISOString();

const match = (over: Partial<MatchInput> = {}): MatchInput => ({
  id: "m1",
  team_a: "Team Heretics",
  team_b: "NRG",
  start_time: future(4),
  status: "upcoming",
  winner_team: null,
  round: null,
  match_order: null,
  ...over,
});

test("solo se pueden predecir partidos futuros con los dos equipos definidos", () => {
  assert.equal(isPredictable(match(), NOW), true);
  assert.equal(isPredictable(match({ start_time: past(1) }), NOW), false, "ya empezado");
  assert.equal(isPredictable(match({ team_b: null }), NOW), false, "rival por determinar");
  assert.equal(isPredictable(match({ start_time: null }), NOW), false, "sin hora no hay cierre");
  assert.equal(isPredictable(match({ status: "finished" }), NOW), false, "terminado");
  assert.equal(isPredictable(match({ status: "live" }), NOW), false, "en directo");
});

test("una pregunta cierra cuando empieza SU partido, no cuando cierra el torneo", () => {
  const qs = buildMatchQuestions([match({ start_time: future(9) })], NOW);
  assert.equal(qs.length, 1);
  assert.equal(qs[0].locksAt, future(9));
});

test("las opciones son el LADO del partido, no el nombre del equipo", () => {
  // Un nombre de equipo cambia; el lado no. Las respuestas guardadas apuntan a la clave.
  const [q] = buildMatchQuestions([match()], NOW);
  assert.deepEqual(q.options.map((o) => o.key), ["a", "b"]);
  assert.deepEqual(q.options.map((o) => o.label), ["Team Heretics", "NRG"]);
});

test("las preguntas salen ordenadas por hora de inicio", () => {
  const qs = buildMatchQuestions([
    match({ id: "tarde", start_time: future(20) }),
    match({ id: "pronto", start_time: future(2) }),
    match({ id: "medio", start_time: future(8) }),
  ], NOW);
  assert.deepEqual(qs.map((q) => q.matchId), ["pronto", "medio", "tarde"]);
});

test("acertar una final vale más que acertar un partido de grupos", () => {
  assert.ok(pointsForRound("Grand Final") > pointsForRound("Group Stage"));
  assert.ok(pointsForRound("Final") > pointsForRound("Group Stage"));
  assert.ok(pointsForRound("Semifinal") > pointsForRound("Group Stage"));
});

test("«semifinal» no se confunde con «final» pese a contenerla", () => {
  // El orden de la tabla de patrones es lo que evita el falso positivo.
  assert.notEqual(pointsForRound("Semifinal"), pointsForRound("Final"));
  assert.equal(pointsForRound("Semifinal"), pointsForRound("semi"));
});

test("una ronda desconocida o ausente cae en el valor por defecto, no revienta", () => {
  assert.equal(pointsForRound(null), DEFAULT_QUESTION_POINTS);
  assert.equal(pointsForRound(""), DEFAULT_QUESTION_POINTS);
  assert.equal(pointsForRound("Ronda inventada 7"), DEFAULT_QUESTION_POINTS);
});

test("el ganador se traduce al lado correcto, ignorando mayúsculas y espacios", () => {
  assert.equal(correctOptionFor(match({ winner_team: "Team Heretics" })), "a");
  assert.equal(correctOptionFor(match({ winner_team: "  nrg " })), "b");
});

test("sin ganador todavía no se sabe, y eso NO es «nadie acertó»", () => {
  assert.equal(correctOptionFor(match({ winner_team: null })), null);
  assert.equal(isResolved(match({ winner_team: null })), false);
});

test("un ganador que no es ninguno de los dos lados no inventa un acierto", () => {
  // Dato inconsistente del origen: se prefiere «no se sabe» a puntuar a alguien al azar.
  assert.equal(correctOptionFor(match({ winner_team: "Sentinels" })), null);
  assert.equal(isResolved(match({ winner_team: "Sentinels" })), false);
});

test("generar dos veces sobre los mismos partidos da exactamente lo mismo", () => {
  // Es lo que permite reejecutar la sincronización sin duplicar preguntas.
  const ms = [match({ id: "a" }), match({ id: "b", start_time: future(6) })];
  assert.deepEqual(buildMatchQuestions(ms, NOW), buildMatchQuestions(ms, NOW));
});

// ───────────────────────── Fase 13 · resultado exacto ─────────────────────────

test("un partido predecible genera DOS preguntas: ganador y resultado", () => {
  const m = {
    id: "m1", team_a: "Team Heretics", team_b: "Karmine Corp",
    start_time: new Date(NOW + 3600_000).toISOString(), status: "upcoming",
    winner_team: null, round: "final", match_order: 1,
  };
  const winner = buildMatchQuestions([m], NOW);
  const score = buildScoreQuestions([m], NOW);
  assert.equal(winner.length, 1);
  assert.equal(score.length, 1);
  assert.equal(winner[0].kind, "match_winner");
  assert.equal(score[0].kind, "match_score");
  // Las dos cierran cuando empieza el partido: una que cerrara despues seria una pregunta
  // que se puede responder viendo el marcador.
  assert.equal(score[0].locksAt, winner[0].locksAt);
});

test("el resultado exacto paga el doble que el ganador del mismo partido", () => {
  /*
   * Con cuatro opciones en vez de dos, acertar a ciegas baja del 50 % al 25 %. Pagar el
   * doble por la mitad de probabilidad deja el valor esperado de adivinar EXACTAMENTE igual
   * que antes: la pregunta premia saber, no sube el suelo de quien va al azar.
   */
  const m = {
    id: "m1", team_a: "A", team_b: "B", start_time: new Date(NOW + 3600_000).toISOString(),
    status: "upcoming", winner_team: null, round: "grand final", match_order: 1,
  };
  const w = buildMatchQuestions([m], NOW)[0];
  const s = buildScoreQuestions([m], NOW)[0];
  assert.equal(s.points, w.points * SCORE_POINTS_MULTIPLIER);
  assert.equal(s.options.length, 4);
  assert.equal(w.options.length, 2);
});

test("el marcador se corrige contra los datos reales del partido", () => {
  const base = {
    id: "m1", team_a: "Team Heretics", team_b: "Karmine Corp",
    start_time: new Date(NOW - 3600_000).toISOString(), status: "finished",
    winner_team: "Team Heretics", round: "final", match_order: 1,
  };
  assert.equal(correctScoreOptionFor({ ...base, score_a: 2, score_b: 0 }), "2-0");
  assert.equal(correctScoreOptionFor({ ...base, score_a: 1, score_b: 2 }), "1-2");
});

test("sin los DOS marcadores no se corrige nada", () => {
  /*
   * `null` es «todavia no se sabe», que NO es lo mismo que «nadie acerto». Un partido con
   * un solo marcador es un dato a medias del origen, y a medias no se puntua a nadie.
   */
  const base = {
    id: "m1", team_a: "A", team_b: "B", start_time: new Date(NOW - 1000).toISOString(),
    status: "finished", winner_team: "A", round: null, match_order: 1,
  };
  assert.equal(correctScoreOptionFor(base), null);
  assert.equal(correctScoreOptionFor({ ...base, score_a: 2 }), null);
  assert.equal(correctScoreOptionFor({ ...base, score_a: 2, score_b: null }), null);
  assert.equal(correctScoreOptionFor({ ...base, score_a: -1, score_b: 2 }), null);
});

test("un marcador fuera de las opciones ofrecidas no puntua a nadie", () => {
  // Un 3-1 de una final al mejor de cinco no estaba entre las cuatro opciones: nadie pudo
  // elegirlo, asi que nadie lo cobra. Inventar un acierto seria peor que no corregir.
  const m = {
    id: "m1", team_a: "A", team_b: "B", start_time: new Date(NOW - 1000).toISOString(),
    status: "finished", winner_team: "A", round: null, match_order: 1,
    score_a: 3, score_b: 1,
  };
  assert.equal(correctScoreOptionFor(m), null);
});

test("el corrector generico elige el metodo por el tipo de pregunta", () => {
  const m = {
    id: "m1", team_a: "A", team_b: "B", start_time: new Date(NOW - 1000).toISOString(),
    status: "finished", winner_team: "B", round: null, match_order: 1,
    score_a: 0, score_b: 2,
  };
  assert.equal(correctOptionForKind("match_winner", m), "b");
  assert.equal(correctOptionForKind("match_score", m), "0-2");
  // Un tipo desconocido cae al de ganador en vez de romper el corrector entero.
  assert.equal(correctOptionForKind("loquesea", m), "b");
});

test("las preguntas de resultado van DESPUES de todas las de ganador", () => {
  // Si se intercalaran, la lista alternaria «quien gana / con que resultado» y habria que
  // leer dos veces cada fila para saber que se esta preguntando.
  const ms = [1, 2, 3].map((i) => ({
    id: `m${i}`, team_a: "A", team_b: "B",
    start_time: new Date(NOW + i * 3600_000).toISOString(), status: "upcoming",
    winner_team: null, round: null, match_order: i,
  }));
  const w = buildMatchQuestions(ms, NOW);
  const s = buildScoreQuestions(ms, NOW);
  assert.ok(Math.min(...s.map((q) => q.orderIdx)) > Math.max(...w.map((q) => q.orderIdx)));
});
