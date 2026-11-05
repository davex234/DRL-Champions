/**
 * PICK'EMS · EL CUADRO COMO GRAFO (Fase 24.3) — pruebas puras.
 *
 * Fixtures MÍNIMOS y etiquetados: reproducen la forma de los datos reales (`stages.kind`,
 * `matches.round` con las etiquetas que publica VLR, `match_order`, `start_time`, ganador real)
 * sin fingir ningún torneo de producción.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRound, getTournamentFormat, buildBracketModel, layoutStage, winnerSide, canPickMatch, isBracketFormat,
  type BracketMatchInput, type StageLike,
} from "./bracket";
import type { AnswerMap, QuestionLike } from "./progress";

const NOW = Date.parse("2026-03-10T12:00:00Z");
const at = (h: number) => new Date(NOW + h * 3600_000).toISOString();

const m = (id: string, over: Partial<BracketMatchInput> = {}): BracketMatchInput => ({
  id, stage_id: "st-po", team_a: null, team_b: null, team_a_id: null, team_b_id: null, start_time: at(24),
  status: "upcoming", score_a: null, score_b: null, winner_team_id: null, winner_team: null, round: null, match_order: null, ...over,
});
const played = (id: string, a: string, b: string, round: string, sa: number, sb: number, h: number, extra: Partial<BracketMatchInput> = {}) =>
  m(id, { team_a: a, team_b: b, team_a_id: a.toLowerCase(), team_b_id: b.toLowerCase(), round, score_a: sa, score_b: sb,
    winner_team_id: (sa > sb ? a : b).toLowerCase(), winner_team: sa > sb ? a : b, status: "finished", start_time: at(h), ...extra });

const PLAYOFF: StageLike[] = [{ id: "st-po", name: "Playoffs", kind: "playoff", order_idx: 1 }];
const GROUPS: StageLike[] = [{ id: "st-g", name: "Group Stage", kind: "group", order_idx: 0 }];

/** Fixture: eliminación simple a 8 con dos cuartos jugados (forma del seed de demo). */
const single = (): BracketMatchInput[] => [
  played("qf1", "TH", "KC", "Quarterfinal", 2, 0, -72, { match_order: 1 }),
  played("qf2", "FNC", "TL", "Quarterfinal", 1, 2, -48, { match_order: 2 }),
  m("qf3", { team_a: "NRG", team_b: "SEN", round: "Quarterfinal", match_order: 3, status: "live", score_a: 1, score_b: 1, start_time: at(-1) }),
  m("qf4", { team_a: "GENG", team_b: "DRX", round: "Quarterfinal", match_order: 4, start_time: at(24) }),
  m("sf1", { team_a: "TH", team_b: "TL", round: "Semifinal", match_order: 5, start_time: at(72) }),
  m("sf2", { round: "Semifinal", match_order: 6, start_time: at(96) }), // TBD vs TBD
  m("f", { round: "Final", match_order: 7, start_time: at(144) }),
];

const q = (id: string, matchId: string | null, over: Partial<QuestionLike & { match_id: string | null; kind: string }> = {}) => ({
  id, kind: "match_winner", match_id: matchId, points: 15, locks_at: at(24), locked: false, correct_option: null, order_idx: 0,
  options: [{ key: "a", label: "A" }, { key: "b", label: "B" }], ...over,
});

/* ─────────────── 1-5 · DETECCIÓN ─────────────── */

test("LIGA · jornadas («Week 3») o fases group/swiss → no hay cuadro", () => {
  const league = [m("w1", { round: "Week 1", team_a: "A", team_b: "B" }), m("w2", { round: "Week 2", team_a: "C", team_b: "D" })];
  assert.equal(getTournamentFormat({ matches: league }), "LEAGUE");
  assert.equal(getTournamentFormat({ stages: GROUPS, matches: league.map((x) => ({ ...x, stage_id: "st-g" })) }), "GROUP_STAGE");
  assert.equal(getTournamentFormat({ stages: [{ id: "s", name: "Swiss", kind: "swiss" }], matches: [m("a", { stage_id: "s", round: "Round 1" })] }), "SWISS");
  assert.ok(!isBracketFormat("LEAGUE") && !isBracketFormat("GROUP_STAGE") && !isBracketFormat("SWISS"));
});

test("ELIMINACIÓN SIMPLE · fase playoff o etiquetas cuartos/semis/final → SINGLE_ELIMINATION", () => {
  assert.equal(getTournamentFormat({ stages: PLAYOFF, matches: single() }), "SINGLE_ELIMINATION");
  assert.equal(getTournamentFormat({ matches: single().map((x) => ({ ...x, stage_id: null })) }), "SINGLE_ELIMINATION");
  assert.equal(getTournamentFormat({ matches: [m("a", { round: "Cuartos" }), m("b", { round: "Semifinal" }), m("c", { round: "Final" })] }), "SINGLE_ELIMINATION");
});

test("ELIMINACIÓN DOBLE · una rama «Lower» → DOUBLE_ELIMINATION", () => {
  const dbl = [m("u1", { round: "Upper Semifinal" }), m("l1", { round: "Lower Round 1" }), m("gf", { round: "Grand Final" })];
  assert.equal(getTournamentFormat({ stages: PLAYOFF, matches: dbl }), "DOUBLE_ELIMINATION");
});

test("GRUPOS + PLAYOFFS · dos fases de distinto tipo → GROUP_PLAYOFF; grupos GSL (Opening/Winners) cuentan como cuadro", () => {
  const both = [m("g1", { stage_id: "st-g", round: "Week 1", team_a: "A", team_b: "B" }), ...single()];
  assert.equal(getTournamentFormat({ stages: [...GROUPS, ...PLAYOFF], matches: both }), "GROUP_PLAYOFF");
  const gsl = [m("o1", { stage_id: "st-g", round: "Opening (A)" }), m("w1", { stage_id: "st-g", round: "Winners (A)" }), m("d1", { stage_id: "st-g", round: "Decider (A)" })];
  assert.equal(getTournamentFormat({ stages: GROUPS, matches: gsl }), "SINGLE_ELIMINATION");
});

test("DESCONOCIDO · sin partidos o sin etiquetas útiles → UNKNOWN (la pantalla vuelve a la vista normal)", () => {
  assert.equal(getTournamentFormat({ matches: [] }), "UNKNOWN");
  assert.equal(getTournamentFormat({ matches: [m("x", { round: null }), m("y", { round: "" })] }), "UNKNOWN");
  assert.equal(getTournamentFormat({ matches: [m("x", { round: "Serie 7" })] }), "UNKNOWN");
});

test("NO se decide por el nombre del torneo: la misma función no recibe nombre alguno", async () => {
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("./bracket.ts", import.meta.url), "utf8"));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/includes\("Masters"\)|includes\("Champions"\)|event\.name|\.name\.includes/.test(code));
});

/* ─────────────── 6 · RONDAS ─────────────── */

test("ETIQUETAS · se reconocen las oficiales (inglés y español) y se ordenan por rango: opening < winners < decider, R16 < QF < SF < F < GF", () => {
  assert.equal(parseRound("Upper Quarterfinals").side, "upper");
  assert.equal(parseRound("Lower Round 2").side, "lower");
  assert.equal(parseRound("Lower Round 2").rank, 12);
  assert.equal(parseRound("Grand Final").side, "grand");
  assert.equal(parseRound("Gran Final").label, "Gran Final");
  assert.equal(parseRound("Cuartos").label, "Cuartos");
  assert.equal(parseRound("Opening (A)").label, "Apertura");
  assert.equal(parseRound("Winners (B)").label, "Ganadores");
  assert.equal(parseRound("Decider").label, "Decisivo");
  assert.equal(parseRound("Elimination").label, "Eliminación");
  assert.ok(parseRound("Round of 16").rank! < parseRound("Quarterfinal").rank!);
  assert.ok(parseRound("Quarterfinal").rank! < parseRound("Semifinal").rank!);
  assert.ok(parseRound("Semifinal").rank! < parseRound("Final").rank! && parseRound("Final").rank! < parseRound("Grand Final").rank!);
  assert.ok(parseRound("Opening").rank! < parseRound("Winners").rank! && parseRound("Winners").rank! < parseRound("Decider").rank!);
  assert.equal(parseRound("Week 4").league, true);
  assert.equal(parseRound("Semifinal").label, "Semifinal", "una etiqueta oficial reconocible se conserva");
});

test("RONDAS · orden real: cuartos → semis → final; dentro de la ronda por match_order; datos reales del partido intactos", () => {
  const model = buildBracketModel({ stages: PLAYOFF, matches: single(), questions: [], answers: {}, now: NOW });
  assert.deepEqual(model.rounds.map((r) => r.label), ["Quarterfinal", "Semifinal", "Final"]);
  assert.deepEqual(model.rounds[0].matchIds, ["qf1", "qf2", "qf3", "qf4"]);
  assert.ok(model.reliable);
  const qf1 = model.matches.qf1;
  assert.equal(qf1.teamA?.name, "TH"); assert.equal(qf1.scoreA, 2); assert.equal(qf1.scoreB, 0);
  assert.equal(qf1.winner, "a", "ganador del backend");
  assert.equal(qf1.status, "finished");
  assert.equal(model.matches.qf3.status, "live");
});

test("RONDAS · con rango y horas contradictorias el modelo se marca NO fiable (fallback a la vista normal)", () => {
  const raro = [m("a", { round: "Semifinal", start_time: at(1), team_a: "A", team_b: "B" }), m("b", { round: "Quarterfinal", start_time: at(50), team_a: "C", team_b: "D" })];
  const model = buildBracketModel({ stages: PLAYOFF, matches: raro, questions: [], answers: {}, now: NOW });
  assert.equal(model.reliable, false);
});

test("DOBLE · upper arriba, lower abajo, gran final al final; layout por fase", () => {
  const dbl = [
    played("uqf1", "A", "B", "Upper Quarterfinal", 2, 0, -100, { match_order: 1 }),
    played("uqf2", "C", "D", "Upper Quarterfinal", 2, 1, -96, { match_order: 2 }),
    m("usf", { team_a: "A", team_b: "C", round: "Upper Semifinal", start_time: at(-40) }),
    m("lr1", { team_a: "B", team_b: "D", round: "Lower Round 1", start_time: at(-60) }),
    m("lf", { round: "Lower Final", start_time: at(20) }),
    m("gf", { round: "Grand Final", start_time: at(60) }),
  ];
  const model = buildBracketModel({ stages: PLAYOFF, matches: dbl, questions: [], answers: {}, now: NOW });
  assert.equal(model.format, "DOUBLE_ELIMINATION");
  const lay = layoutStage(model, "st-po");
  assert.deepEqual(lay.upper.map((c) => c.round.label), ["Upper Quarterfinal", "Upper Semifinal", "Grand Final"]);
  assert.deepEqual(lay.lower.map((c) => c.round.label), ["Lower Round 1", "Lower Final"]);
});

/* ─────────────── 8-9 · MARCADOR, TBD ─────────────── */

test("GANADOR · sale de winner_team_id / winner_team; nunca del marcador", () => {
  assert.equal(winnerSide(m("x", { team_a: "A", team_b: "B", team_a_id: "a", team_b_id: "b", score_a: 0, score_b: 2, winner_team_id: "a" })), "a", "el backend manda aunque contradiga el marcador");
  assert.equal(winnerSide(m("x", { team_a: "A", team_b: "B", score_a: 2, score_b: 0 })), null, "sin ganador declarado no se deduce");
  assert.equal(winnerSide(m("x", { team_a: "A", team_b: "B", winner_team: "b " })), "b");
});

test("TBD · un partido sin equipos no se puede predecir aunque exista pregunta abierta", () => {
  const model = buildBracketModel({ stages: PLAYOFF, matches: single(), questions: [q("qsf2", "sf2")], answers: {}, now: NOW });
  const sf2 = model.matches.sf2;
  assert.equal(sf2.teamA, null); assert.equal(sf2.teamB, null);
  assert.equal(canPickMatch(sf2), false);
  const sf1 = buildBracketModel({ stages: PLAYOFF, matches: single(), questions: [q("qsf1", "sf1")], answers: {}, now: NOW }).matches.sf1;
  assert.equal(canPickMatch(sf1), true, "con equipos y pregunta abierta, sí");
});

/* ─────────────── 11-18 · PREDICCIÓN SOBRE LA CAJA ─────────────── */

test("PICK · la caja lleva su pregunta real, sus opciones (lados) y sus puntos del servidor", () => {
  const model = buildBracketModel({ stages: PLAYOFF, matches: single(), questions: [q("qsf1", "sf1", { points: 20 })], answers: {}, now: NOW });
  const sf1 = model.matches.sf1;
  assert.equal(sf1.questionId, "qsf1"); assert.equal(sf1.optionA, "a"); assert.equal(sf1.optionB, "b");
  assert.equal(sf1.points, 20); assert.equal(sf1.lockState, "open"); assert.equal(sf1.pickState, "pendiente");
  assert.equal(model.matches.qf4.questionId, null, "sin pregunta, sin pick");
  assert.equal(model.matches.qf4.lockState, "none");
});

test("PICK · seleccionada, bloqueada, acertada (+N del corrector), fallada (+0), sin predicción", () => {
  const qs = [
    q("q1", "sf1"),
    q("q2", "qf1", { locked: true, locks_at: at(-72), correct_option: "a", points: 15 }),
    q("q3", "qf2", { locked: true, locks_at: at(-48), correct_option: "b", points: 15 }),
    q("q4", "qf3", { locked: true, locks_at: at(-1) }),
  ];
  const answers: AnswerMap = {
    q1: { option: "b", isCorrect: null, pointsAward: null },
    q2: { option: "a", isCorrect: true, pointsAward: 15 },
    q3: { option: "a", isCorrect: false, pointsAward: 0 },
  };
  const model = buildBracketModel({ stages: PLAYOFF, matches: single(), questions: qs, answers, now: NOW });
  assert.equal(model.matches.sf1.pickState, "elegida"); assert.equal(model.matches.sf1.selectedOption, "b");
  assert.equal(model.matches.qf1.pickState, "acertada"); assert.equal(model.matches.qf1.pointsAward, 15); assert.equal(model.matches.qf1.lockState, "resolved");
  assert.equal(model.matches.qf2.pickState, "fallada"); assert.equal(model.matches.qf2.pointsAward, 0);
  assert.equal(model.matches.qf3.pickState, "sin-prediccion"); assert.equal(model.matches.qf3.lockState, "locked");
  assert.equal(canPickMatch(model.matches.qf3), false, "bloqueada: no editable");
});

/* ─────────────── 19-22 · ARISTAS ─────────────── */

test("WINNER · el ganador de un cuarto jugado que aparece en la semifinal genera la arista, con su hueco", () => {
  const model = buildBracketModel({ stages: PLAYOFF, matches: single(), questions: [], answers: {}, now: NOW });
  const winners = model.edges.filter((e) => e.source === "WINNER");
  assert.deepEqual(winners, [
    { from: "qf1", to: "sf1", source: "WINNER", slot: "a" },
    { from: "qf2", to: "sf1", source: "WINNER", slot: "b" },
  ]);
});

test("LOSER · el perdedor de un partido del cuadro alto que aparece en el bajo genera arista LOSER", () => {
  const dbl = [
    played("uqf1", "A", "B", "Upper Quarterfinal", 2, 0, -100),
    m("usf", { team_a: "A", team_b: "C", round: "Upper Semifinal", start_time: at(-40) }),
    m("lr1", { team_a: "B", team_b: "D", round: "Lower Round 1", start_time: at(-60) }),
  ];
  const model = buildBracketModel({ stages: PLAYOFF, matches: dbl, questions: [], answers: {}, now: NOW });
  assert.deepEqual(model.edges, [
    { from: "uqf1", to: "usf", source: "WINNER", slot: "a" },
    { from: "uqf1", to: "lr1", source: "LOSER", slot: "a" },
  ]);
});

test("NO SE INVENTA · un partido en juego, uno futuro o un TBD no generan aristas; una liga tampoco", () => {
  const model = buildBracketModel({ stages: PLAYOFF, matches: single(), questions: [], answers: {}, now: NOW });
  assert.ok(!model.edges.some((e) => e.from === "qf3" || e.from === "qf4" || e.to === "sf2" || e.to === "f"));
  const league = buildBracketModel({ matches: [played("w1", "A", "B", "Week 1", 2, 0, -100), m("w2", { team_a: "A", team_b: "C", round: "Week 2" })], questions: [], answers: {}, now: NOW });
  assert.equal(league.format, "LEAGUE");
  assert.equal(league.edges.length, 0, "en liga no hay progresión que dibujar");
});

test("ARISTA AUSENTE · el modelo sigue siendo válido: rondas completas y sin referencias colgando", () => {
  const model = buildBracketModel({ stages: PLAYOFF, matches: single(), questions: [], answers: {}, now: NOW });
  for (const e of model.edges) { assert.ok(model.matches[e.from]); assert.ok(model.matches[e.to]); }
  const total = model.rounds.reduce((s, r) => s + r.matchIds.length, 0);
  assert.equal(total, single().length, "ninguna caja se pierde por no tener arista");
});

test("GRUPOS + PLAYOFF · las fases se separan y solo la de playoff se marca como cuadro", () => {
  const both = [m("g1", { stage_id: "st-g", round: "Week 1", team_a: "A", team_b: "B" }), ...single()];
  const model = buildBracketModel({ stages: [...GROUPS, ...PLAYOFF], matches: both, questions: [], answers: {}, now: NOW });
  assert.equal(model.format, "GROUP_PLAYOFF");
  assert.deepEqual(model.stages.map((s) => [s.name, s.bracket]), [["Group Stage", false], ["Playoffs", true]]);
  assert.equal(layoutStage(model, "st-g").upper.length, 1);
  assert.equal(layoutStage(model, "st-po").upper.length, 3);
});

test("DETERMINISMO · el mismo torneo produce el mismo modelo", () => {
  const a = buildBracketModel({ stages: PLAYOFF, matches: single(), questions: [], answers: {}, now: NOW });
  const b = buildBracketModel({ stages: PLAYOFF, matches: single(), questions: [], answers: {}, now: NOW });
  assert.deepEqual(a, b);
});
