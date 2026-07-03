/**
 * Tests del Match Engine (node:test, sin dependencias nuevas).
 * Ejecutar: `npx tsx --test src/match/engine.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CoachSetup } from "../sim";
import { DEMO_HOME, DEMO_AWAY } from "../sim/mapping/demoRoster";
import { createMatch, simulateMatch, stepMatch } from "./engine";
import { makeMatchConfig, type MatchConfigInput } from "./config";
import type { MatchEventType, MatchPhase, MatchState } from "./types";

const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };
const ROSTERS = { home: DEMO_HOME, away: DEMO_AWAY };

function cfg(over: Partial<MatchConfigInput> = {}) {
  return makeMatchConfig({ seed: 12345, rosters: ROSTERS, homeSetup: SETUP, ...over });
}
const countEv = (m: MatchState, t: MatchEventType) => m.events.filter((e) => e.type === t).length;

test("un partido completo llega a MATCH_END con un ganador", () => {
  const m = simulateMatch(cfg());
  assert.equal(m.phase, "MATCH_END");
  assert.ok(m.winner === "home" || m.winner === "away");
  assert.equal(m.loser, m.winner === "home" ? "away" : "home");
});

test("la condición de victoria respeta firstTo + winBy", () => {
  const m = simulateMatch(cfg());
  const w = m.winner === "home" ? m.score.home : m.score.away;
  const l = m.winner === "home" ? m.score.away : m.score.home;
  assert.ok(w >= m.config.win.firstTo, `ganador ${w} < firstTo ${m.config.win.firstTo}`);
  assert.ok(w - l >= m.config.win.winBy);
});

test("el marcador cuadra con el historial", () => {
  const m = simulateMatch(cfg());
  assert.equal(m.history.length, m.rounds.length);
  assert.equal(m.score.home + m.score.away, m.history.length);
  // numeración secuencial y marcador monótono
  m.history.forEach((h, i) => {
    assert.equal(h.number, i + 1);
    if (i > 0) {
      const prev = m.history[i - 1].scoreAfter;
      assert.ok(h.scoreAfter.home >= prev.home && h.scoreAfter.away >= prev.away);
      assert.equal(h.scoreAfter.home + h.scoreAfter.away, i + 1);
    }
  });
  assert.deepEqual(m.history[m.history.length - 1].scoreAfter, m.score);
});

test("hay UN cambio de lado en la media parte (configurable, no hardcodeado)", () => {
  const m = simulateMatch(cfg());
  assert.equal(countEv(m, "SIDE_SWITCHED"), 1);
  // El lado del equipo home en la ronda switchAfter+1 difiere del inicial.
  const startSide = m.history[0].homeSide;
  const afterSwitch = m.history[m.config.switchAfter]; // índice = switchAfter → ronda switchAfter+1
  assert.ok(afterSwitch, "el partido debe pasar de la media parte");
  assert.notEqual(afterSwitch.homeSide, startSide);
});

test("la condición de victoria es CONFIGURABLE (first to 4, switch a 3)", () => {
  const m = simulateMatch(cfg({ win: { firstTo: 4, winBy: 1 }, switchAfter: 3 }));
  assert.equal(m.phase, "MATCH_END");
  const w = m.winner === "home" ? m.score.home : m.score.away;
  assert.ok(w >= 4);
  assert.equal(countEv(m, "SIDE_SWITCHED"), 1);
  assert.notEqual(m.history[3].homeSide, m.history[0].homeSide);
});

test("la narrativa se construye sobre el PARTIDO entero", () => {
  const m = simulateMatch(cfg());
  assert.ok(m.narrative, "debe existir NarrativeState");
  assert.equal(m.narrative!.match.rounds, m.history.length);
  assert.ok(m.narrative!.timeline.length > 0);
  assert.ok(m.narrative!.summary);
});

test("determinismo: misma config ⇒ mismo partido", () => {
  const a = simulateMatch(cfg());
  const b = simulateMatch(cfg());
  assert.deepEqual(a.score, b.score);
  assert.equal(a.winner, b.winner);
  assert.equal(a.history.length, b.history.length);
  assert.deepEqual(a.history.map((h) => h.winnerSide), b.history.map((h) => h.winnerSide));
  assert.deepEqual(a.events.map((e) => e.type), b.events.map((e) => e.type));
});

test("eventos del partido bien registrados (preparado para Broadcast/Replay)", () => {
  const m = simulateMatch(cfg());
  assert.equal(countEv(m, "MATCH_STARTED"), 1);
  assert.equal(countEv(m, "MATCH_ENDED"), 1);
  assert.equal(countEv(m, "ROUND_STARTED"), m.history.length);
  assert.equal(countEv(m, "ROUND_FINISHED"), m.history.length);
  assert.equal(countEv(m, "VICTORY") + countEv(m, "DEFEAT"), 1);
  assert.ok(countEv(m, "MATCH_POINT") >= 1, "debe haber al menos un match point");
});

test("no hay estados imposibles: winner solo al final; rondas acotadas", () => {
  let s = createMatch(cfg());
  const seenPhases = new Set<MatchPhase>();
  let guard = 0;
  while (s.phase !== "MATCH_END" && guard++ < 1000) {
    assert.equal(s.winner, null, `winner no debe fijarse antes de MATCH_END (fase ${s.phase})`);
    s = stepMatch(s);
    seenPhases.add(s.phase);
  }
  assert.equal(s.phase, "MATCH_END");
  assert.equal(s.currentRound, null, "no debe quedar ronda en curso (sin fugas)");
  assert.ok(s.rounds.length <= s.config.maxRounds);
  assert.ok(seenPhases.has("ROUND_RUNNING") && seenPhases.has("ROUND_END"));
});

test("stepMatch en MATCH_END es terminal (idempotente)", () => {
  const m = simulateMatch(cfg());
  const again = stepMatch(m);
  assert.equal(again.phase, "MATCH_END");
  assert.deepEqual(again.score, m.score);
  assert.equal(again.events.length, m.events.length);
});
