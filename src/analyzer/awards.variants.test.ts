/**
 * PREMIOS DE LAS TRES VARIANTES BLOQUEADAS — clutch, rookie y campeón.
 *
 * `computeAwards` es el punto EXACTO en el que se decide si estas tres cartas existen: de sus
 * `AwardResult` salen los accolades `tournament-clutch` / `tournament-rookie` y, vía el
 * narrativeTag `champion`, `tournament-champion`. Lo que se prueba aquí no es la aritmética
 * —eso es trivial— sino la regla del encargo: **sin dato no hay premio, y ninguna otra
 * estadística ocupa el sitio de la que falta.**
 *
 * Todos los datos son de FIXTURE. Ni un nick ni una cifra describen a una persona real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAwards } from "./awards";
import type { PlayerReport, TeamReport } from "./types";
import type { CanonicalModel } from "@/importer";

/** Jugador de fixture con lo mínimo que `computeAwards` mira. */
function jugador(p: Partial<PlayerReport> & { playerId: string }): PlayerReport {
  return {
    nick: p.playerId, teamId: "t:a", maps: 10, matches: 5,
    acs: 200, adr: 130, kast: 70, kd: 1, hsPct: 25,
    kills: 100, deaths: 100, assists: 50, fk: 10, fd: 10, clutches: 0,
    rating: 50, impact: 50, consistency: 50, variance: 0, mvpScore: 50,
    roles: { duelist: 0, controller: 0, sentinel: 0, initiator: 0, entry: 0, support: 0 },
    rolePerformance: 0, trend: "steady",
    ...p,
  } as PlayerReport;
}

function equipo(t: Partial<TeamReport> & { teamId: string }): TeamReport {
  return {
    name: t.teamId, wins: 3, losses: 1, mapsWon: 7, mapsLost: 3, roundDiff: 20, series: 4,
    winrate: 0.75, strengthOfSchedule: 0.5, eliminated: false, qualified: true,
    champion: false, runnerUp: false, thirdPlace: false, groupWinner: false,
    reachedPlayoff: true, perfectRun: false, reverseSweep: false,
    ...t,
  } as TeamReport;
}

/** Modelo canónico mínimo: solo lo que `computeAwards` consulta. */
function modelo(players: { id: string; status?: string; agents?: string[]; teamId?: string }[]): CanonicalModel {
  const ps = players.map((p) => ({
    id: p.id, nick: p.id, teamId: p.teamId ?? "t:a", status: p.status ?? "", agents: p.agents ?? [],
  }));
  return {
    players: ps, coaches: [], teams: [],
    index: { playerById: new Map(ps.map((p) => [p.id, p])), teamById: new Map() },
  } as unknown as CanonicalModel;
}

const kind = (out: ReturnType<typeof computeAwards>, k: string) => out.find((a) => a.kind === k);

/* ───────────────────────────────── CLUTCH ───────────────────────────────── */

test("CLUTCH · sin dato en ninguna parte, el premio NO se concede", () => {
  // Ni agregado de torneo ni suma por mapa: es el estado de vlr.gg antes de esta fase.
  const players = [jugador({ playerId: "a", kills: 500, fk: 90 }), jugador({ playerId: "b", kills: 400 })];
  const out = computeAwards(players, [equipo({ teamId: "t:a" })], modelo([{ id: "a" }, { id: "b" }]));
  assert.equal(kind(out, "best-clutch"), undefined, "sin dato de clutch no hay Clutch King");
});

test("CLUTCH · el líder en kills NO se lleva el premio de clutch", () => {
  /*
   * El jugador «a» arrasa en kills, first kills y asistencias y no tiene ni un clutch medido;
   * «b» tiene menos de todo pero SÍ tiene clutches. El premio es de «b». Si alguna vez se
   * derivase clutch de otra columna, aquí ganaría «a».
   */
  const players = [
    jugador({ playerId: "a", kills: 900, fk: 200, assists: 300 }),
    jugador({ playerId: "b", kills: 10, fk: 0, tournamentClutchesWon: 3, tournamentClutchSituations: 9 }),
  ];
  const out = computeAwards(players, [equipo({ teamId: "t:a" })], modelo([{ id: "a" }, { id: "b" }]));
  assert.equal(kind(out, "best-clutch")?.playerId, "b");
});

test("CLUTCH · con agregado de torneo gana quien más GANÓ, no quien más jugó", () => {
  const players = [
    jugador({ playerId: "muchas-situaciones", tournamentClutchesWon: 5, tournamentClutchSituations: 90 }),
    jugador({ playerId: "mas-ganadas", tournamentClutchesWon: 12, tournamentClutchSituations: 30 }),
  ];
  const out = computeAwards(players, [equipo({ teamId: "t:a" })], modelo([{ id: "muchas-situaciones" }, { id: "mas-ganadas" }]));
  assert.equal(kind(out, "best-clutch")?.playerId, "mas-ganadas");
  assert.equal(kind(out, "best-clutch")?.value, 12);
});

test("CLUTCH · no se comparan jugadores medidos de formas distintas", () => {
  /*
   * Si en un mismo torneo unos traen agregado y otros no, solo compiten los que lo traen.
   * Mezclarlos daría un ganador decidido por a quién le faltaba el dato.
   */
  const players = [
    jugador({ playerId: "sin-agregado", clutches: 40 }),
    jugador({ playerId: "con-agregado", tournamentClutchesWon: 2, tournamentClutchSituations: 5 }),
  ];
  const out = computeAwards(players, [equipo({ teamId: "t:a" })], modelo([{ id: "sin-agregado" }, { id: "con-agregado" }]));
  assert.equal(kind(out, "best-clutch")?.playerId, "con-agregado");
});

test("CLUTCH · una fuente que sí publique clutch por mapa sigue funcionando", () => {
  // Compatibilidad: sin agregados, se usa el recuento por mapa de siempre.
  const players = [jugador({ playerId: "a", clutches: 2 }), jugador({ playerId: "b", clutches: 9 })];
  const out = computeAwards(players, [equipo({ teamId: "t:a" })], modelo([{ id: "a" }, { id: "b" }]));
  assert.equal(kind(out, "best-clutch")?.playerId, "b");
});

test("CLUTCH · cero ganadas por todos no concede premio", () => {
  const players = [
    jugador({ playerId: "a", tournamentClutchesWon: 0, tournamentClutchSituations: 11 }),
    jugador({ playerId: "b", tournamentClutchesWon: 0, tournamentClutchSituations: 4 }),
  ];
  const out = computeAwards(players, [equipo({ teamId: "t:a" })], modelo([{ id: "a" }, { id: "b" }]));
  assert.equal(kind(out, "best-clutch"), undefined, "nadie ganó ninguno ⇒ no hay Clutch King");
});

/* ───────────────────────────────── ROOKIE ───────────────────────────────── */

test("ROOKIE · sin status, NO se concede (no se inventan rookies)", () => {
  const players = [jugador({ playerId: "a", mvpScore: 99 }), jugador({ playerId: "b", mvpScore: 80 })];
  const out = computeAwards(players, [equipo({ teamId: "t:a" })], modelo([{ id: "a" }, { id: "b" }]));
  assert.equal(kind(out, "best-rookie"), undefined, "es el estado real con vlr.gg hoy");
});

test("ROOKIE · un status desconocido tampoco concede", () => {
  const out = computeAwards(
    [jugador({ playerId: "a", mvpScore: 99 })],
    [equipo({ teamId: "t:a" })],
    modelo([{ id: "a", status: "active" }]),
  );
  assert.equal(kind(out, "best-rookie"), undefined, "«active» no dice nada de ser rookie");
});

test("ROOKIE · con status válido se concede al mejor ENTRE LOS MARCADOS", () => {
  /*
   * El jugador con más mvpScore NO es rookie: el premio tiene que irse al rookie, no al mejor
   * del torneo. Es la definición que usa NEXUS, y no es «jugador joven».
   */
  const players = [
    jugador({ playerId: "estrella", mvpScore: 99 }),
    jugador({ playerId: "novato-bueno", mvpScore: 70 }),
    jugador({ playerId: "novato-flojo", mvpScore: 40 }),
  ];
  const out = computeAwards(players, [equipo({ teamId: "t:a" })], modelo([
    { id: "estrella" }, { id: "novato-bueno", status: "Rookie" }, { id: "novato-flojo", status: "rookie" },
  ]));
  assert.equal(kind(out, "best-rookie")?.playerId, "novato-bueno");
});

/* ──────────────────────────── CHAMPION EDITION ──────────────────────────── */

test("CHAMPION · sin campeón, best-team cae a winrate y NO se afirma un título", () => {
  const out = computeAwards(
    [jugador({ playerId: "a" })],
    [equipo({ teamId: "t:a", winrate: 0.9 }), equipo({ teamId: "t:b", winrate: 0.2 })],
    modelo([{ id: "a" }]),
  );
  assert.equal(kind(out, "best-team")?.reason, "mejor winrate", "sin dato no se dice «campeón»");
});

test("CHAMPION · con campeón, el premio de equipo lo gana ÉL y por título", () => {
  const out = computeAwards(
    [jugador({ playerId: "a" })],
    [equipo({ teamId: "t:a", winrate: 0.2, champion: true }), equipo({ teamId: "t:b", winrate: 0.99 })],
    modelo([{ id: "a" }]),
  );
  const bt = kind(out, "best-team");
  assert.equal(bt?.teamId, "t:a", "el campeón gana aunque otro tenga mejor winrate");
  assert.equal(bt?.reason, "campeón");
});

test("CHAMPION · cambiar quién es campeón cambia el resultado (nada fijado en código)", () => {
  const conA = computeAwards([jugador({ playerId: "x" })],
    [equipo({ teamId: "t:a", champion: true }), equipo({ teamId: "t:b" })], modelo([{ id: "x" }]));
  const conB = computeAwards([jugador({ playerId: "x" })],
    [equipo({ teamId: "t:a" }), equipo({ teamId: "t:b", champion: true })], modelo([{ id: "x" }]));
  assert.equal(kind(conA, "best-team")?.teamId, "t:a");
  assert.equal(kind(conB, "best-team")?.teamId, "t:b");
});
