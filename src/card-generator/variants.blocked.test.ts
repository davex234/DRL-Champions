/**
 * LAS TRES VARIANTES BLOQUEADAS, DE PUNTA A PUNTA.
 *
 * Este test recorre la cadena COMPLETA —snapshot crudo → modelo canónico → analyzer →
 * card generator— y comprueba lo único que importa de estas tres cartas: que existan cuando
 * el dato existe, y que NO existan cuando no. Los tests de parser (`importer-vlr/*.test.ts`)
 * y los de premio (`analyzer/awards.variants.test.ts`) cubren los eslabones por separado;
 * aquí se comprueba que el cable llega hasta la carta.
 *
 * ─────────────────────────── TODO ES FIXTURE ───────────────────────────
 *
 * «Alpha Esports» y «Bravo Gaming» no existen, y ninguna cifra de aquí describe a un jugador
 * real. El fixture es un banco de pruebas del CÓDIGO, nunca una afirmación sobre nadie.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { importSnapshot, makeClock, createIdentityResolver, buildRegistry, type RawSnapshot, type ImportCtx } from "@/importer";
import { analyze } from "@/analyzer";
import { generateCards, type GeneratorCtx } from "@/card-generator";
import { MIN_ROUNDS } from "@/domain/cards/combat";
import type { Player } from "@/domain/cards/types";

const ictx = (): ImportCtx => ({ clock: makeClock(1_700_000_000_000), identity: createIdentityResolver(buildRegistry([])) });

const metrics = (i: number): Player["metrics"] => ({
  rounds: 4 * MIN_ROUNDS + i, kills: 300 + 4 * i, deaths: 250 + 2 * i, assists: 90 + 3 * i,
  fk: 55 + i, fd: 40 + i, acs: 210 + 4 * i, adr: 145 + 2 * i,
  kd: 1.2 - i * 0.02, kast: 72 + i, hsPct: 24 + i, clutches: 6 + (i % 4),
});

const rosterPlayer = (id: string, team: string, i: number): Player => ({
  id, nick: id, team, teamTag: team.slice(0, 3).toUpperCase(), region: "EMEA", role: "Duelista", country: "es",
  stats: { dmg: 80, scr: 82, com: 78, hs: 75, ast: 70, clu: 72 }, accolades: [],
  image: `/players/${id}.png`, metrics: metrics(i),
});

/** Catálogo inyectado: los cuatro jugadores del fixture existen como cartas. */
const ROSTER: Player[] = [
  rosterPlayer("ana", "Alpha Esports", 0),
  rosterPlayer("abel", "Alpha Esports", 1),
  rosterPlayer("bruno", "Bravo Gaming", 2),
  rosterPlayer("berta", "Bravo Gaming", 3),
];

/**
 * Snapshot de fixture parametrizado por QUIÉN es campeón y QUIÉN tiene clutch.
 *
 * `champion` y `clutchFor` son los dos únicos ejes que cambian entre casos: todo lo demás es
 * idéntico, así que cualquier diferencia en la salida viene del dato y no de otra cosa.
 */
function snapshot(opts: { champion?: string; clutchFor?: { player: string; won: number; played: number }[] }): RawSnapshot {
  return {
    tournament: { id: "fx-1", name: "Fixture Open 2026", type: "champions", tier: "vct-international", status: "finished", startDate: "2026-01-01T00:00:00Z" },
    stages: [{ id: "st-po", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
    teams: [{ id: "alpha", name: "Alpha Esports", region: "EMEA" }, { id: "bravo", name: "Bravo Gaming", region: "EMEA" }],
    players: [
      { id: "ana", nick: "ana", team: "Alpha Esports", role: "duelist", agents: ["Jett", "Raze", "Neon"] },
      { id: "abel", nick: "abel", team: "Alpha Esports", role: "initiator", agents: ["Sova"] },
      { id: "bruno", nick: "bruno", team: "Bravo Gaming", role: "sentinel", agents: ["Killjoy"] },
      { id: "berta", nick: "berta", team: "Bravo Gaming", role: "controller", agents: ["Omen"] },
    ],
    matches: [{ id: "m1", stageId: "st-po", teamA: "Alpha Esports", teamB: "Bravo Gaming", status: "finished", format: "bo3", scoreA: 2, scoreB: 0, winner: "Alpha Esports", round: "Grand Final", matchOrder: 1 }],
    maps: [
      { id: "m1a", matchId: "m1", map: "Ascent", mapOrder: 1, scoreA: 13, scoreB: 7, winner: "Alpha Esports" },
      { id: "m1b", matchId: "m1", map: "Haven", mapOrder: 2, scoreA: 13, scoreB: 9, winner: "Alpha Esports" },
    ],
    mapStats: [
      { matchMapId: "m1a", matchId: "m1", player: "ana", team: "Alpha Esports", agent: "Jett", acs: 300, kills: 22, deaths: 10, assists: 4, kast: 82, adr: 175, hsPct: 33, fk: 6, fd: 2 },
      { matchMapId: "m1b", matchId: "m1", player: "ana", team: "Alpha Esports", agent: "Raze", acs: 240, kills: 16, deaths: 11, assists: 5, kast: 76, adr: 155, hsPct: 28, fk: 3, fd: 2 },
      { matchMapId: "m1a", matchId: "m1", player: "abel", team: "Alpha Esports", agent: "Sova", acs: 190, kills: 12, deaths: 12, assists: 10, kast: 74, adr: 140, hsPct: 22, fk: 1, fd: 1 },
      { matchMapId: "m1a", matchId: "m1", player: "bruno", team: "Bravo Gaming", agent: "Killjoy", acs: 210, kills: 14, deaths: 15, assists: 5, kast: 68, adr: 145, hsPct: 24, fk: 2, fd: 3 },
      { matchMapId: "m1b", matchId: "m1", player: "berta", team: "Bravo Gaming", agent: "Omen", acs: 180, kills: 11, deaths: 14, assists: 8, kast: 66, adr: 132, hsPct: 20, fk: 1, fd: 3 },
    ],
    playerTournamentStats: (opts.clutchFor ?? []).map((c) => ({
      player: c.player, clutchesWon: c.won, clutchSituations: c.played,
    })),
    awards: opts.champion ? { champion: opts.champion } : undefined,
  };
}

function run(opts: Parameters<typeof snapshot>[0]) {
  const model = importSnapshot(snapshot(opts), ictx()).model;
  const analysis = analyze(model, []);
  const ctx: GeneratorCtx = { roster: ROSTER, now: 1_700_000_000_000 };
  const res = generateCards(analysis, ctx);
  return {
    res,
    /** Jugadores (id de catálogo) que recibieron un accolade concreto. */
    conAccolade: (a: string) => res.grants.filter((g) => g.accolade === a).map((g) => g.playerId).sort(),
    /** Jugadores con una variante de carta concreta. */
    conVariante: (v: string) => res.cards.filter((c) => c.variantId === v).map((c) => c.playerId).sort(),
  };
}

/* ──────────────────────── CHAMPION EDITION ──────────────────────── */

test("CHAMPION · el roster del campeón —y solo él— recibe la variante", () => {
  const r = run({ champion: "Alpha Esports" });
  assert.deepEqual(r.conAccolade("tournament-champion"), ["abel", "ana"], "los dos de Alpha");
  const conVariante = r.conVariante("champion-edition");
  assert.deepEqual(conVariante, ["abel", "ana"]);
  assert.ok(!conVariante.includes("bruno") && !conVariante.includes("berta"), "nadie de Bravo");
});

test("CHAMPION · un torneo SIN campeón no genera ninguna Champion Edition", () => {
  const r = run({});
  assert.deepEqual(r.conAccolade("tournament-champion"), []);
  assert.deepEqual(r.conVariante("champion-edition"), []);
});

test("CHAMPION · cambiar el campeón del fixture cambia quién recibe la carta", () => {
  /*
   * El test que exige el encargo: nada de `if (torneo === X) campeón = Y`. El mismo código,
   * el mismo roster y los mismos partidos —Alpha gana la final en los dos casos— producen
   * cartas distintas porque el DATO de campeón es distinto.
   */
  const conAlpha = run({ champion: "Alpha Esports" }).conVariante("champion-edition");
  const conBravo = run({ champion: "Bravo Gaming" }).conVariante("champion-edition");
  assert.deepEqual(conAlpha, ["abel", "ana"]);
  assert.deepEqual(conBravo, ["berta", "bruno"]);
  assert.notDeepEqual(conAlpha, conBravo);
});

test("CHAMPION · un campeón que no está en el torneo no concede nada", () => {
  const r = run({ champion: "Equipo Que No Juega" });
  assert.deepEqual(r.conVariante("champion-edition"), [], "sin roster que premiar, no hay cartas");
});

/* ──────────────────────────── CLUTCH ──────────────────────────── */

test("CLUTCH · con dato de la fuente, la carta se genera para el líder", () => {
  const r = run({
    champion: "Alpha Esports",
    clutchFor: [{ player: "bruno", won: 11, played: 30 }, { player: "ana", won: 4, played: 25 }],
  });
  assert.deepEqual(r.conAccolade("tournament-clutch"), ["bruno"]);
  assert.deepEqual(r.conVariante("clutch"), ["bruno"], "la gana el líder aunque sea del subcampeón");
});

test("CLUTCH · sin dato de clutch, NO se genera ninguna carta de clutch", () => {
  // Es el estado real de vlr.gg antes de esta fase: nadie trae el agregado.
  const r = run({ champion: "Alpha Esports" });
  assert.deepEqual(r.conAccolade("tournament-clutch"), []);
  assert.deepEqual(r.conVariante("clutch"), []);
});

test("CLUTCH · el MVP del torneo no hereda la carta de clutch", () => {
  /*
   * «ana» domina el scoreboard (más kills, más ACS, gana la final) y no tiene clutch medido.
   * La carta de clutch es de «berta», que es la única con el dato. Si alguna vez el clutch se
   * derivara del rendimiento general, este test lo caza.
   */
  const r = run({ champion: "Alpha Esports", clutchFor: [{ player: "berta", won: 2, played: 6 }] });
  assert.deepEqual(r.conVariante("clutch"), ["berta"]);
  assert.ok(r.conVariante("champion-edition").includes("ana"), "ana sí es campeona…");
  assert.ok(!r.conVariante("clutch").includes("ana"), "…pero eso no la hace Clutch King");
});

/* ──────────────────────────── ROOKIE ──────────────────────────── */

test("ROOKIE · sigue bloqueada: sin status en la fuente no se genera nada", () => {
  /*
   * Este test documenta un BLOQUEO, y es tan importante como los otros: mientras no haya una
   * fuente de `status`, la carta de rookie no debe aparecer. Si algún día alguien la
   * «desbloquea» inventando un criterio (edad, mapas jugados, primer torneo visto), este test
   * se pone rojo y obliga a justificar de dónde sale el dato.
   */
  const r = run({ champion: "Alpha Esports", clutchFor: [{ player: "bruno", won: 5, played: 12 }] });
  assert.deepEqual(r.conAccolade("tournament-rookie"), []);
  assert.deepEqual(r.conVariante("rookie"), []);
});

/* ──────────────────────── NO ROMPER LO QUE YA FUNCIONA ──────────────────────── */

test("las seis variantes que ya funcionaban siguen generándose", () => {
  const r = run({ champion: "Alpha Esports" });
  for (const v of ["mythic", "top-rating", "top-acs", "top-kills", "top-assist", "top-hs"]) {
    assert.ok(r.conVariante(v).length > 0, `${v} debería seguir generándose`);
  }
});

test("el resultado es determinista", () => {
  const a = JSON.stringify(run({ champion: "Alpha Esports", clutchFor: [{ player: "bruno", won: 5, played: 12 }] }).res.cards);
  const b = JSON.stringify(run({ champion: "Alpha Esports", clutchFor: [{ player: "bruno", won: 5, played: 12 }] }).res.cards);
  assert.equal(a, b);
});
