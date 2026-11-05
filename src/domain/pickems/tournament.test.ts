/**
 * PICK'EMS · CAMPEÓN Y CLASIFICACIÓN (Fase 24.2) — pruebas puras.
 *
 * Lo que protegen: que las opciones salgan de los participantes REALES (nunca de una lista
 * escrita), que la pregunta de campeón no nazca con el torneo empezado ni sin fecha, que se
 * corrija solo contra la gran final y solo con un ganador que estuviera entre las opciones,
 * y que `advance` no se invente sola.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { MatchInput } from "./questions";
import {
  buildChampionQuestion, correctChampionOption, correctAdvanceOption, eventParticipants,
  hasTournamentStarted, isGrandFinal, mergeOptions, teamOptionKey, tournamentStartsAt,
  CHAMPION_POINTS, MIN_CHAMPION_PARTICIPANTS, CHAMPION_ORDER_IDX,
} from "./tournament";

const NOW = Date.parse("2026-03-01T12:00:00Z");
const future = (h: number) => new Date(NOW + h * 3600_000).toISOString();
const past = (h: number) => new Date(NOW - h * 3600_000).toISOString();

const m = (over: Partial<MatchInput> = {}): MatchInput => ({
  id: "m", team_a: "Team Heretics", team_b: "Fnatic", start_time: future(24),
  status: "upcoming", winner_team: null, round: "Group A", match_order: 1, ...over,
});

const cuadro = (): MatchInput[] => [
  m({ id: "m1", team_a: "Team Heretics", team_b: "Fnatic", start_time: future(24) }),
  m({ id: "m2", team_a: "Team Liquid", team_b: "Karmine Corp", start_time: future(26) }),
  m({ id: "m3", team_a: "Leviatán", team_b: "NRG", start_time: future(48), round: "Group B" }),
];

test("la clave de un equipo es estable: sin tildes, minúsculas, guiones", () => {
  assert.equal(teamOptionKey("Team Heretics "), "team-heretics");
  assert.equal(teamOptionKey("Leviatán"), "leviatan");
  assert.equal(teamOptionKey("Gen.G"), "gen-g");
});

test("las opciones son los participantes reales de los partidos, sin repetir y ordenadas", () => {
  const opts = eventParticipants([...cuadro(), m({ id: "m4", team_a: "Fnatic", team_b: "NRG" })]);
  assert.deepEqual(opts.map((o) => o.key), ["fnatic", "karmine-corp", "leviatan", "nrg", "team-heretics", "team-liquid"]);
  assert.equal(opts.find((o) => o.key === "team-heretics")?.label, "Team Heretics");
});

test("un hueco del cuadro («por decidir») no es un participante", () => {
  const opts = eventParticipants([m({ team_a: null, team_b: "NRG" }), m({ team_a: "  ", team_b: "Fnatic" })]);
  assert.deepEqual(opts.map((o) => o.key), ["fnatic", "nrg"]);
});

test("la pregunta de campeón nace con los participantes reales, cierra al primer partido y vale sus puntos", () => {
  const q = buildChampionQuestion(cuadro(), NOW);
  assert.ok(q, "hay pregunta");
  assert.equal(q!.kind, "champion");
  assert.equal(q!.options.length, 6);
  assert.equal(q!.locksAt, future(24), "cierra cuando empieza el torneo");
  assert.equal(q!.points, CHAMPION_POINTS);
  assert.equal(q!.orderIdx, CHAMPION_ORDER_IDX, "va antes que las de partido");
});

test("con pocos participantes no hay pregunta de campeón: eso ya es un match_winner", () => {
  assert.equal(MIN_CHAMPION_PARTICIPANTS, 4);
  assert.equal(buildChampionQuestion([m()], NOW), null);
});

test("NO nace si el torneo ya ha empezado (un partido jugado, en vivo o con la hora pasada)", () => {
  assert.equal(buildChampionQuestion([...cuadro(), m({ id: "x", status: "finished" })], NOW), null);
  assert.equal(buildChampionQuestion([...cuadro(), m({ id: "x", status: "live" })], NOW), null);
  assert.equal(buildChampionQuestion([...cuadro(), m({ id: "x", start_time: past(1) })], NOW), null);
  assert.ok(hasTournamentStarted([m({ start_time: past(1) })], NOW));
  assert.ok(!hasTournamentStarted(cuadro(), NOW));
});

test("NO nace sin una fecha de inicio a la que anclar el cierre", () => {
  const sinFecha = cuadro().map((x) => ({ ...x, start_time: null }));
  assert.equal(tournamentStartsAt(sinFecha), null);
  assert.equal(buildChampionQuestion(sinFecha, NOW), null);
});

test("generar dos veces da exactamente lo mismo (idempotencia del generador)", () => {
  assert.deepEqual(buildChampionQuestion(cuadro(), NOW), buildChampionQuestion(cuadro(), NOW));
});

test("«final» a secas y «grand final» son la gran final; semifinal, lower/upper final no", () => {
  assert.ok(isGrandFinal("Grand Final"));
  assert.ok(isGrandFinal("Playoffs: Grand Final"));
  assert.ok(isGrandFinal("Gran Final"));
  assert.ok(isGrandFinal("Final"));
  assert.ok(!isGrandFinal("Semifinal"));
  assert.ok(!isGrandFinal("Lower Final"));
  assert.ok(!isGrandFinal("Upper Final"));
  assert.ok(!isGrandFinal("Group A"));
  assert.ok(!isGrandFinal(null));
});

test("el campeón se corrige contra la gran final TERMINADA, y el ganador debe ser uno de sus lados", () => {
  const opts = eventParticipants(cuadro());
  const gf = m({ id: "gf", round: "Grand Final", team_a: "Fnatic", team_b: "NRG", status: "finished", winner_team: "fnatic " });
  assert.equal(correctChampionOption([...cuadro(), gf], opts), "fnatic");
  // Sin terminar, no se sabe.
  assert.equal(correctChampionOption([...cuadro(), { ...gf, status: "live" }], opts), null);
  // Ganador que no es ninguno de los dos lados: dato inconsistente, no se inventa.
  assert.equal(correctChampionOption([...cuadro(), { ...gf, winner_team: "Sentinels" }], opts), null);
});

test("un ganador que no estaba entre las opciones NO cierra la pregunta", () => {
  const opts = eventParticipants(cuadro());
  const gf = m({ id: "gf", round: "Grand Final", team_a: "Sentinels", team_b: "NRG", status: "finished", winner_team: "Sentinels" });
  assert.equal(correctChampionOption([gf], opts), null);
});

test("sin partido de gran final no hay campeón, aunque el torneo haya terminado", () => {
  const todos = cuadro().map((x) => ({ ...x, status: "finished", winner_team: x.team_a }));
  assert.equal(correctChampionOption(todos, eventParticipants(todos)), null);
});

test("refrescar opciones AÑADE equipos nuevos y renombra, pero nunca quita ninguno", () => {
  const prev = [{ key: "fnatic", label: "FNATIC" }, { key: "nrg", label: "NRG" }];
  const next = [{ key: "fnatic", label: "Fnatic" }, { key: "sentinels", label: "Sentinels" }];
  const out = mergeOptions(prev, next);
  assert.deepEqual(out, [
    { key: "fnatic", label: "Fnatic" }, { key: "nrg", label: "NRG" }, { key: "sentinels", label: "Sentinels" },
  ]);
  assert.deepEqual(prev[0], { key: "fnatic", label: "FNATIC" }, "no muta la entrada");
});

test("advance: se corrige solo si EXACTAMENTE una opción está clasificada", () => {
  const opts = [{ key: "fnatic" }, { key: "nrg" }];
  assert.equal(correctAdvanceOption(opts, ["fnatic"]), "fnatic");
  assert.equal(correctAdvanceOption(opts, []), null, "sin clasificados, pendiente");
  assert.equal(correctAdvanceOption(opts, ["fnatic", "nrg"]), null, "dos clasificadas: mal planteada");
  assert.equal(correctAdvanceOption(opts, ["sentinels"]), null);
});

test("advance NO tiene generador automático: no existe ninguna función que la invente", async () => {
  const mod = await import("./tournament");
  assert.ok(!("buildAdvanceQuestions" in mod) && !("buildAdvanceQuestion" in mod),
    "la pregunta de clasificación no se genera sola sin datos de clasificados");
});
