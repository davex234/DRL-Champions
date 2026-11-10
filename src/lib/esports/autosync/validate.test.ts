/**
 * AUTO-SYNC · VALIDACIÓN, TRANSICIONES Y DIFF (Fase 24.6) — la parte pura de las pruebas 12–23.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_AUTO_SYNC_CONFIG } from "./config";
import { classifyTransition, diffMatches, isSuspiciousShrink, resultsFingerprint, validateRawMatch, type KnownMatch } from "./validate";
import type { RawMatch } from "@/lib/esports/sync/source";

const cfg = DEFAULT_AUTO_SYNC_CONFIG;
const raw = (p: Partial<RawMatch> & { id: string }): RawMatch => ({ eventId: "e", teamAId: "a", teamBId: "b", status: "upcoming", ...p });
const known = (p: Partial<KnownMatch> & { id: string }): KnownMatch => ({ status: "upcoming", score_a: null, score_b: null, winner_team_id: null, ...p });

test("validación · payload contradictorio se descarta con motivo (nunca se arregla)", () => {
  assert.equal(validateRawMatch(raw({ id: "ok" })), null);
  assert.equal(validateRawMatch(raw({ id: "ok2", status: "finished", scoreA: 2, scoreB: 0, winnerTeamId: "a" })), null);
  assert.match(validateRawMatch(raw({ id: "same", teamBId: "a" }))!, /mismo equipo/);
  assert.match(validateRawMatch(raw({ id: "w", winnerTeamId: "zzz" }))!, /ganador/);
  assert.match(validateRawMatch(raw({ id: "c", status: "finished", scoreA: 0, scoreB: 2, winnerTeamId: "a" }))!, /contradice/);
  assert.match(validateRawMatch(raw({ id: "f", status: "finished" }))!, /sin ganador ni marcador/);
  assert.match(validateRawMatch(raw({ id: "t", startTime: "ayer" }))!, /fecha/);
  assert.match(validateRawMatch(raw({ id: "s", scoreA: 1.5 }))!, /entero/);
  assert.match(validateRawMatch(raw({ id: "self", progression: { evidence: "SOURCE_STRUCTURED_HTML", confidence: "CONFIRMED", winnerTo: { matchId: "self" } } }))!, /sí mismo/);
});

test("transiciones · upcoming→live→finished progresan; upcoming→finished DIRECTO también", () => {
  assert.equal(classifyTransition(known({ id: "m" }), raw({ id: "m", status: "live" })), "progress");
  assert.equal(classifyTransition(known({ id: "m", status: "live" }), raw({ id: "m", status: "finished", winnerTeamId: "a" })), "progress");
  assert.equal(classifyTransition(known({ id: "m" }), raw({ id: "m", status: "finished", winnerTeamId: "a" })), "progress", "no hace falta haber visto el directo");
  assert.equal(classifyTransition(undefined, raw({ id: "m" })), "new");
});

test("transiciones · finished→upcoming con resultado previo es REGRESIÓN y se rechaza; sin resultado previo, no", () => {
  const done = known({ id: "m", status: "finished", score_a: 2, score_b: 1, winner_team_id: "a" });
  assert.equal(classifyTransition(done, raw({ id: "m", status: "upcoming" })), "regression");
  assert.equal(classifyTransition(done, raw({ id: "m", status: "live" })), "regression");
  const emptyFinished = known({ id: "m", status: "finished" });
  assert.equal(classifyTransition(emptyFinished, raw({ id: "m", status: "live" })), "progress");
  assert.equal(classifyTransition(known({ id: "m", status: "live" }), raw({ id: "m", status: "upcoming" })), "revert", "un directo que se retrasa no pierde nada");
});

test("transiciones · corrección de la fuente sobre un partido terminado se detecta (no es «same»)", () => {
  const done = known({ id: "m", status: "finished", score_a: 2, score_b: 1, winner_team_id: "a" });
  assert.equal(classifyTransition(done, raw({ id: "m", status: "finished", scoreA: 2, scoreB: 1, winnerTeamId: "a" })), "same");
  assert.equal(classifyTransition(done, raw({ id: "m", status: "finished", scoreA: 1, scoreB: 2, winnerTeamId: "b" })), "correction");
  assert.equal(classifyTransition(done, raw({ id: "m", status: "finished", scoreA: 2, scoreB: 0, winnerTeamId: "a" })), "correction", "marcador distinto, mismo ganador");
});

test("diff · fuente sin cambios → todo unchanged, nada creado ni terminado", () => {
  const k = [known({ id: "1", status: "finished", score_a: 2, score_b: 0, winner_team_id: "a", start_time: "2026-09-27T10:00:00.000Z" }), known({ id: "2", start_time: "2026-09-28T10:00:00.000Z" })];
  const d = diffMatches(k, [
    raw({ id: "1", status: "finished", scoreA: 2, scoreB: 0, winnerTeamId: "a", startTime: "2026-09-27T10:00:00Z" }),
    raw({ id: "2", startTime: "2026-09-28T10:00:00Z" }),
  ]);
  assert.equal(d.unchanged, 2);
  assert.deepEqual([d.created, d.updated, d.finished, d.corrections, d.rejected, d.invalid], [[], [], [], [], [], []]);
  assert.equal(d.accepted.length, 2);
});

test("diff · nuevo partido, cambio de hora, marcador, ganador, terminado directo y rechazo", () => {
  const k = [
    known({ id: "1", start_time: "2026-09-27T10:00:00.000Z" }),
    known({ id: "2", status: "finished", score_a: 2, score_b: 1, winner_team_id: "a" }),
    known({ id: "3", status: "finished", score_a: 2, score_b: 1, winner_team_id: "a" }),
  ];
  const d = diffMatches(k, [
    raw({ id: "1", startTime: "2026-09-27T12:00:00Z" }),                                  // hora movida
    raw({ id: "2", status: "finished", scoreA: 2, scoreB: 0, winnerTeamId: "a" }),          // corrección de marcador
    raw({ id: "3", status: "upcoming" }),                                                   // regresión → rechazo
    raw({ id: "4", status: "finished", scoreA: 1, scoreB: 2, winnerTeamId: "b" }),          // nuevo y ya terminado
    raw({ id: "5", status: "finished" }),                                                   // inválido
    raw({ id: "4" }),                                                                       // duplicado
  ]);
  assert.deepEqual(d.updated, ["1", "2"]);
  assert.deepEqual(d.corrections.map((c) => c.matchId), ["2"]);
  assert.deepEqual(d.rejected.map((r) => r.matchId), ["3"]);
  assert.deepEqual(d.created, ["4"]);
  assert.deepEqual(d.finished, ["4"]);
  assert.deepEqual(d.invalid.map((i) => i.matchId), ["5", "4"]);
  assert.ok(!d.accepted.some((m) => m.id === "3"), "el rechazado no se escribe: se conserva el resultado");
});

test("diff · upcoming→finished directo cuenta como terminado (scoring sin haber visto LIVE)", () => {
  const d = diffMatches([known({ id: "gf" })], [raw({ id: "gf", status: "finished", scoreA: 3, scoreB: 1, winnerTeamId: "a" })]);
  assert.deepEqual(d.finished, ["gf"]);
  assert.deepEqual(d.updated, ["gf"]);
});

test("fuente sospechosa · vacía o encogida con partidos conocidos → se corta; sin conocidos, no", () => {
  assert.equal(isSuspiciousShrink(0, 0, cfg), null);
  assert.match(isSuspiciousShrink(12, 0, cfg)!, /no devuelve partidos/);
  assert.match(isSuspiciousShrink(12, 3, cfg)!, /3 partidos de 12/);
  assert.equal(isSuspiciousShrink(12, 7, cfg), null);
  assert.equal(isSuspiciousShrink(3, 1, cfg), null, "con pocos conocidos no se puede afirmar");
});

test("huella · misma lista (en cualquier orden) → misma huella; cambia con estado, marcador o ganador", () => {
  const a = [raw({ id: "1", status: "finished", scoreA: 2, scoreB: 0, winnerTeamId: "a" }), raw({ id: "2" })];
  const b = [raw({ id: "2" }), raw({ id: "1", status: "finished", scoreA: 2, scoreB: 0, winnerTeamId: "a" })];
  assert.equal(resultsFingerprint(a), resultsFingerprint(b));
  assert.notEqual(resultsFingerprint(a), resultsFingerprint([raw({ id: "1", status: "finished", scoreA: 2, scoreB: 1, winnerTeamId: "a" }), raw({ id: "2" })]));
  assert.notEqual(resultsFingerprint(a), resultsFingerprint([raw({ id: "1", status: "finished", scoreA: 2, scoreB: 0, winnerTeamId: "a" }), raw({ id: "2", status: "live" })]));
});

test("validación · huecos TBD: TBD vs TBD se acepta como estructura; terminado con TBD se rechaza", () => {
  assert.equal(validateRawMatch(raw({ id: "w", teamAId: "vlr-t-tbd", teamBId: "vlr-t-tbd" })), null);
  assert.match(validateRawMatch(raw({ id: "w", teamAId: "vlr-t-tbd", teamBId: "vlr-t-tbd", status: "finished", scoreA: 2, scoreB: 0 }))!, /hueco/);
});
