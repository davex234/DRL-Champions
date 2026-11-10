/**
 * PICK'EMS · ESTRUCTURA CONFIRMADA DEL CUADRO (Fase 24.4) — pruebas puras del dominio.
 *
 * Fixtures MÍNIMOS y etiquetados (QA SYNTHETIC): reproducen las columnas de la migración 0045
 * tal y como las escribiría el importador. Lo que se prueba: que una arista estructural
 * exista ANTES del resultado, que UNKNOWN/INFERRED nunca pinten, que los conflictos se
 * detecten en vez de resolverse a ojo, y que el grafo inválido degrade sin romper nada.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBracketModel, layoutStage, edgeKey, hasCycle, qualificationNodeId,
  type BracketMatchInput, type StageLike,
} from "./bracket";

const NOW = Date.parse("2026-03-10T12:00:00Z");
const at = (h: number) => new Date(NOW + h * 3600_000).toISOString();
const PLAYOFF: StageLike[] = [{ id: "st-po", name: "Playoffs", kind: "playoff", order_idx: 1 }];
const GROUP: StageLike[] = [{ id: "st-g", name: "Group Stage", kind: "group", order_idx: 0 }];

const m = (id: string, over: Partial<BracketMatchInput> = {}): BracketMatchInput => ({
  id, stage_id: "st-po", team_a: null, team_b: null, start_time: at(24), status: "upcoming",
  score_a: null, score_b: null, round: null, match_order: null, ...over,
});
const confirmed = (over: Partial<BracketMatchInput>): Partial<BracketMatchInput> =>
  ({ progression_evidence: "SOURCE_STRUCTURED_HTML", progression_confidence: "CONFIRMED", ...over });
const played = (id: string, a: string, b: string, round: string, sa: number, sb: number, h: number, extra: Partial<BracketMatchInput> = {}) =>
  m(id, { team_a: a, team_b: b, round, score_a: sa, score_b: sb, winner_team: sa > sb ? a : b, status: "finished", start_time: at(h), ...extra });

/** Eliminación simple a 4, SIN jugar, con estructura confirmada y huecos. */
const preMatch = (): BracketMatchInput[] => [
  m("sf1", { team_a: "TH", team_b: "FNC", round: "Semifinal", match_order: 1, start_time: at(2), ...confirmed({ winner_to_match_id: "f", winner_to_slot: 1 }) }),
  m("sf2", { team_a: "G2", team_b: "NRG", round: "Semifinal", match_order: 2, start_time: at(4), ...confirmed({ winner_to_match_id: "f", winner_to_slot: 2 }) }),
  m("f", { round: "Final", match_order: 3, start_time: at(48) }),
];
const build = (matches: BracketMatchInput[], stages = PLAYOFF) => buildBracketModel({ stages, matches, questions: [], answers: {}, now: NOW });
const kinds = (model: ReturnType<typeof build>) => model.edges.map((e) => [e.from, e.to, e.source, e.slot, model.edgeMeta[edgeKey(e)].kind]);

/* ─────────────── 1-7 · ESTRUCTURAL ─────────────── */

test("1-3-6 · arista de ganador CONFIRMADA antes del resultado, con destino TBD y hueco 1", () => {
  const model = build(preMatch());
  assert.deepEqual(kinds(model), [
    ["sf1", "f", "WINNER", "a", "STRUCTURAL"],
    ["sf2", "f", "WINNER", "b", "STRUCTURAL"],
  ]);
  assert.equal(model.matches.f.teamA, null, "el destino sigue siendo TBD");
  assert.equal(model.edgeMeta[edgeKey(model.edges[0])].evidence, "SOURCE_STRUCTURED_HTML");
  assert.equal(model.edgeMeta[edgeKey(model.edges[0])].confidence, "CONFIRMED");
});

test("4 · hueco 2 se conserva; sin hueco (uno a uno) la arista existe con slot null", () => {
  const model = build([
    m("r1", { team_a: "A", team_b: "B", round: "Upper Round 1", start_time: at(1), ...confirmed({ winner_to_match_id: "sf" }) }),
    m("sf", { team_a: "C", round: "Upper Semifinal", start_time: at(10) }),
  ]);
  assert.deepEqual(kinds(model), [["r1", "sf", "WINNER", null, "STRUCTURAL"]]);
});

test("2 · arista de perdedor CONFIRMADA hacia el cuadro bajo, antes de jugarse", () => {
  const model = build([
    m("u1", { team_a: "A", team_b: "B", round: "Upper Semifinal", start_time: at(1), ...confirmed({ winner_to_match_id: "uf", winner_to_slot: 1, loser_to_match_id: "l1", loser_to_slot: 2 }) }),
    m("uf", { round: "Upper Final", start_time: at(20) }),
    m("l1", { round: "Lower Round 1", start_time: at(10) }),
  ]);
  assert.deepEqual(kinds(model), [
    ["u1", "uf", "WINNER", "a", "STRUCTURAL"],
    ["u1", "l1", "LOSER", "b", "STRUCTURAL"],
  ]);
});

test("5 · arista de clasificación: nodo «Clasificado · Por definir» antes, con el equipo real después", () => {
  const antes = build([
    m("d", { stage_id: "st-g", team_a: "PRX", team_b: "TH", round: "Decider (A)", start_time: at(3), ...confirmed({ winner_qualifies: "qualified:groupa:decider", winner_qualifies_label: "Qualified" }) }),
  ], GROUP);
  assert.equal(antes.qualificationNodes.length, 1);
  const node = antes.qualificationNodes[0];
  assert.equal(node.id, qualificationNodeId("qualified:groupa:decider"));
  assert.equal(node.team, null);
  assert.deepEqual(antes.edges, [{ from: "d", to: node.id, source: "WINNER", slot: null }]);
  assert.equal(antes.edgeMeta[edgeKey(antes.edges[0])].toKind, "qualification");

  const despues = build([
    played("d", "PRX", "TH", "Decider (A)", 1, 2, -3, { stage_id: "st-g", ...confirmed({ winner_qualifies: "qualified:groupa:decider", winner_qualifies_label: "Qualified" }) }),
  ], GROUP);
  assert.equal(despues.qualificationNodes[0].team?.name, "TH", "el clasificado es el ganador REAL");
});

test("7 · la arista estructural permanece igual después del resultado; solo cambia el participante del destino", () => {
  const jugado = [
    played("sf1", "TH", "FNC", "Semifinal", 2, 0, -2, { match_order: 1, ...confirmed({ winner_to_match_id: "f", winner_to_slot: 1 }) }),
    m("sf2", { team_a: "G2", team_b: "NRG", round: "Semifinal", match_order: 2, start_time: at(4), ...confirmed({ winner_to_match_id: "f", winner_to_slot: 2 }) }),
    m("f", { team_a: "TH", round: "Final", match_order: 3, start_time: at(48) }),
  ];
  const model = build(jugado);
  assert.deepEqual(kinds(model), [
    ["sf1", "f", "WINNER", "a", "STRUCTURAL"],
    ["sf2", "f", "WINNER", "b", "STRUCTURAL"],
  ]);
  assert.equal(model.matches.f.teamA?.name, "TH");
  assert.equal(model.conflicts.length, 0);
});

/* ─────────────── 8-11 · PRIORIDAD Y CONFIANZA ─────────────── */

test("8-9 · sin estructura, el fallback por resultado sigue; con estructura, la estructural manda y no se duplica", () => {
  const sinEstructura = build([
    played("qf1", "TH", "KC", "Quarterfinal", 2, 0, -72, { match_order: 1 }),
    m("sf1", { team_a: "TH", team_b: "TL", round: "Semifinal", match_order: 5, start_time: at(72) }),
  ]);
  assert.deepEqual(kinds(sinEstructura), [["qf1", "sf1", "WINNER", "a", "RESULT_VERIFIED"]]);
  const conEstructura = build([
    played("qf1", "TH", "KC", "Quarterfinal", 2, 0, -72, { match_order: 1, ...confirmed({ winner_to_match_id: "sf1", winner_to_slot: 1 }) }),
    m("sf1", { team_a: "TH", team_b: "TL", round: "Semifinal", match_order: 5, start_time: at(72) }),
  ]);
  assert.deepEqual(kinds(conEstructura), [["qf1", "sf1", "WINNER", "a", "STRUCTURAL"]]);
});

test("10-11 · UNKNOWN (NULL) e INFERRED nunca pintan una arista estructural", () => {
  const unknown = build([
    m("sf1", { team_a: "TH", team_b: "FNC", round: "Semifinal", start_time: at(2), winner_to_match_id: "f", winner_to_slot: 1, progression_confidence: null, progression_evidence: null }),
    m("f", { round: "Final", start_time: at(48) }),
  ]);
  assert.equal(unknown.edges.length, 0);
  const inferred = build([
    m("sf1", { team_a: "TH", team_b: "FNC", round: "Semifinal", start_time: at(2), winner_to_match_id: "f", winner_to_slot: 1, progression_confidence: "INFERRED", progression_evidence: "SOURCE_STRUCTURED_HTML" }),
    m("f", { round: "Final", start_time: at(48) }),
  ]);
  assert.equal(inferred.edges.length, 0, "INFERRED no se comporta como CONFIRMED");
});

/* ─────────────── 12-18 · CONFLICTOS E INTEGRIDAD ─────────────── */

test("12 · CONFLICTO: la estructura dice C, el ganador real juega D → no se pinta, se registra, y el fallback no elige por su cuenta", () => {
  const model = build([
    played("a", "TH", "FNC", "Quarterfinal", 2, 1, -10, { match_order: 1, ...confirmed({ winner_to_match_id: "c", winner_to_slot: 1 }) }),
    m("c", { team_a: "G2", team_b: "NRG", round: "Semifinal", match_order: 2, start_time: at(5) }),
    m("d", { team_a: "TH", team_b: "SEN", round: "Semifinal", match_order: 3, start_time: at(6) }),
  ]);
  assert.equal(model.edges.length, 0, "ni estructural ni verificada: el conflicto no se resuelve eligiendo");
  assert.equal(model.conflicts.length, 1);
  assert.deepEqual([model.conflicts[0].matchId, model.conflicts[0].expectedTo, model.conflicts[0].observedTo], ["a", "c", "d"]);
});

test("12b · CONFLICTO de hueco: el ganador juega el destino pero no en el hueco anunciado", () => {
  const model = build([
    played("a", "TH", "FNC", "Semifinal", 2, 1, -10, { match_order: 1, ...confirmed({ winner_to_match_id: "f", winner_to_slot: 1 }) }),
    m("f", { team_a: "G2", team_b: "TH", round: "Final", match_order: 3, start_time: at(5) }),
  ]);
  assert.equal(model.edges.length, 0);
  assert.match(model.conflicts[0].reason, /hueco a/);
});

test("13-16 · autoarista, destino inexistente, otra fase y ronda hacia atrás se rechazan (y se anotan)", () => {
  const model = build([
    m("a", { team_a: "A", team_b: "B", round: "Quarterfinal", start_time: at(1), ...confirmed({ winner_to_match_id: "a" }) }),
    m("b", { team_a: "C", team_b: "D", round: "Quarterfinal", start_time: at(1), ...confirmed({ winner_to_match_id: "nope" }) }),
    m("c", { team_a: "E", team_b: "F", round: "Semifinal", start_time: at(10), ...confirmed({ winner_to_match_id: "g" }) }),
    m("g", { stage_id: "st-g", round: "Week 1", start_time: at(20) }),
    m("d", { team_a: "G", team_b: "H", round: "Semifinal", start_time: at(10), ...confirmed({ winner_to_match_id: "a" }) }),
  ], [...GROUP, ...PLAYOFF]);
  assert.equal(model.edges.length, 0);
  assert.ok(model.issues.some((i) => /autoarista/.test(i)));
  assert.ok(model.issues.some((i) => /inexistente/.test(i)));
  assert.ok(model.issues.some((i) => /otra fase/.test(i)));
  assert.ok(model.issues.some((i) => /ronda posterior/.test(i)));
});

test("17 · colisión de hueco: dos partidos confirmados al mismo hueco → ninguna de las dos", () => {
  const model = build([
    m("a", { team_a: "A", team_b: "B", round: "Semifinal", match_order: 1, start_time: at(1), ...confirmed({ winner_to_match_id: "f", winner_to_slot: 1 }) }),
    m("b", { team_a: "C", team_b: "D", round: "Semifinal", match_order: 2, start_time: at(1), ...confirmed({ winner_to_match_id: "f", winner_to_slot: 1 }) }),
    m("f", { round: "Final", start_time: at(10) }),
  ]);
  assert.equal(model.edges.length, 0);
  assert.equal(model.issues.filter((i) => /hueco/.test(i)).length, 2);
});

test("14 · ciclo: se descartan TODAS las aristas estructurales y el cuadro sigue siendo válido", () => {
  const model = build([
    m("a", { team_a: "A", team_b: "B", round: "Round 1", start_time: at(1), ...confirmed({ winner_to_match_id: "b" }) }),
    m("b", { team_a: "C", team_b: "D", round: "Round 2", start_time: at(2), ...confirmed({ winner_to_match_id: "c" }) }),
    m("c", { round: "Round 3", start_time: at(3), ...confirmed({ winner_to_match_id: "a" }) }),
  ]);
  // «c → a» ya cae por «ronda hacia atrás»; el detector de ciclos se prueba directo:
  assert.ok(hasCycle([{ from: "a", to: "b", toKind: "match" }, { from: "b", to: "a", toKind: "match" }]));
  assert.ok(!hasCycle([{ from: "a", to: "b", toKind: "match" }, { from: "b", to: "c", toKind: "match" }]));
  assert.ok(model.reliable && model.rounds.length === 3);
});

/* ─────────────── 21-28 · FORMATOS Y COMPATIBILIDAD ─────────────── */

test("22-25 · doble eliminación: alto, bajo y gran final con huecos; layout intacto", () => {
  const model = build([
    m("us1", { team_a: "A", team_b: "B", round: "Upper Semifinal", match_order: 1, start_time: at(1), ...confirmed({ winner_to_match_id: "uf", winner_to_slot: 1, loser_to_match_id: "lr1", loser_to_slot: 1 }) }),
    m("us2", { team_a: "C", team_b: "D", round: "Upper Semifinal", match_order: 2, start_time: at(2), ...confirmed({ winner_to_match_id: "uf", winner_to_slot: 2, loser_to_match_id: "lr1", loser_to_slot: 2 }) }),
    m("uf", { round: "Upper Final", start_time: at(20), ...confirmed({ winner_to_match_id: "gf", winner_to_slot: 1 }) }),
    m("lr1", { round: "Lower Round 1", start_time: at(10), ...confirmed({ winner_to_match_id: "lf" }) }),
    m("lf", { round: "Lower Final", start_time: at(30), ...confirmed({ winner_to_match_id: "gf", winner_to_slot: 2 }) }),
    m("gf", { round: "Grand Final", start_time: at(40) }),
  ]);
  assert.equal(model.format, "DOUBLE_ELIMINATION");
  assert.equal(model.edges.length, 7);
  assert.equal(model.edges.filter((e) => e.source === "LOSER").length, 2);
  assert.ok(model.edges.some((e) => e.from === "lf" && e.to === "gf" && e.slot === "b"), "Lower Final → Gran Final, hueco 2");
  const lay = layoutStage(model, "st-po");
  assert.deepEqual(lay.upper.map((c) => c.round.label), ["Upper Semifinal", "Upper Final", "Grand Final"]);
  assert.deepEqual(lay.lower.map((c) => c.round.label), ["Lower Round 1", "Lower Final"]);
});

test("26 · reset de gran final: solo si existe como partido en los datos; aquí no existe y no se inventa", () => {
  const model = build([
    m("gf", { team_a: "A", team_b: "B", round: "Grand Final", start_time: at(1) }),
  ]);
  assert.equal(model.rounds.length, 1);
  assert.equal(model.edges.length, 0);
});

test("23 · GSL: Opening → Winner's/Elimination → Decider → Clasificado, con rondas de grupo ordenadas juntas", () => {
  const g = (id: string, a: string | null, b: string | null, round: string, h: number, extra: Partial<BracketMatchInput> = {}) =>
    m(id, { stage_id: "st-g", team_a: a, team_b: b, round, start_time: at(h), ...extra });
  const model = build([
    g("o1", "100T", "T1", "Opening (A)", 1, { match_order: 1, ...confirmed({ winner_to_match_id: "w", winner_to_slot: 1 }) }),
    g("o2", "JDG", "FUT", "Opening (A)", 2, { match_order: 2, ...confirmed({ winner_to_match_id: "w", winner_to_slot: 2 }) }),
    g("w", null, null, "Winner's (A)", 10, { ...confirmed({ winner_qualifies: "qualified:groupa:winners", winner_qualifies_label: "Qualified" }) }),
    g("e", null, null, "Elimination (A)", 11, { ...confirmed({ winner_to_match_id: "d" }) }),
    g("d", null, null, "Decider (A)", 20, { ...confirmed({ winner_qualifies: "qualified:groupa:decider", winner_qualifies_label: "Qualified" }) }),
    g("ob1", "GE", "VIT", "Opening (B)", 1, { match_order: 3 }),
  ], GROUP);
  assert.equal(model.format, "SINGLE_ELIMINATION");
  assert.equal(model.qualificationNodes.length, 2);
  assert.equal(model.edges.length, 5);
  assert.deepEqual(model.rounds.map((r) => `${r.label}${r.group ? "/" + r.group : ""}`), ["Apertura/A", "Ganadores/A", "Eliminación/A", "Decisivo/A", "Apertura/B"]);
  const lay = layoutStage(model, "st-g");
  assert.equal(lay.qualifiedUpper.length + lay.qualifiedLower.length, 2);
});

test("27 · liga: sin aristas aunque las columnas estén rellenas (la estructura no aplica)", () => {
  const model = build([
    played("w1", "A", "B", "Week 1", 2, 0, -100, { stage_id: "st-g", ...confirmed({ winner_to_match_id: "w2" }) }),
    m("w2", { stage_id: "st-g", team_a: "A", team_b: "C", round: "Week 2", start_time: at(1) }),
  ], GROUP);
  assert.equal(model.format, "GROUP_STAGE");
  assert.equal(model.edges.length, 0);
});

test("28 · compatibilidad histórica: un torneo sin columnas 24.4 produce exactamente el modelo de 24.3", () => {
  const legacy = [
    played("qf1", "TH", "KC", "Quarterfinal", 2, 0, -72, { match_order: 1 }),
    played("qf2", "FNC", "TL", "Quarterfinal", 1, 2, -48, { match_order: 2 }),
    m("sf1", { team_a: "TH", team_b: "TL", round: "Semifinal", match_order: 5, start_time: at(72) }),
  ];
  const model = build(legacy);
  assert.deepEqual(model.edges, [
    { from: "qf1", to: "sf1", source: "WINNER", slot: "a" },
    { from: "qf2", to: "sf1", source: "WINNER", slot: "b" },
  ]);
  assert.ok(Object.values(model.edgeMeta).every((x) => x.kind === "RESULT_VERIFIED"));
  assert.equal(model.qualificationNodes.length, 0);
  assert.equal(model.conflicts.length, 0);
});

test("24 · grupos + playoffs: la estructura de playoffs no cruza a la fase de grupos", () => {
  const model = build([
    played("g1", "A", "B", "Week 1", 2, 0, -100, { stage_id: "st-g" }),
    m("sf1", { team_a: "A", team_b: "C", round: "Semifinal", start_time: at(1), ...confirmed({ winner_to_match_id: "f", winner_to_slot: 1 }) }),
    m("f", { round: "Final", start_time: at(10) }),
  ], [...GROUP, ...PLAYOFF]);
  assert.equal(model.format, "GROUP_PLAYOFF");
  assert.equal(model.edges.length, 1);
  assert.equal(layoutStage(model, "st-g").upper.length, 1);
});
