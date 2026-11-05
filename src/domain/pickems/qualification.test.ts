/**
 * PICK'EMS · «¿QUIÉN SE CLASIFICA?» DESDE ESTRUCTURA CONFIRMADA (Fase 24.4).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildQualificationQuestions, correctOptionForKind, type QualificationMatchInput } from "./questions";

const NOW = Date.parse("2026-03-01T12:00:00Z");
const future = (h: number) => new Date(NOW + h * 3600_000).toISOString();

const m = (over: Partial<QualificationMatchInput> = {}): QualificationMatchInput => ({
  id: "d", team_a: "Paper Rex", team_b: "Team Heretics", start_time: future(6), status: "upcoming",
  winner_team: null, round: "Decider (A)", match_order: 5,
  winner_qualifies: "qualified:groupa:decider", winner_qualifies_label: "Qualified", progression_confidence: "CONFIRMED", ...over,
});

test("36-39 · solo con clasificación CONFIRMADA: opciones = los dos equipos reales, cierre = inicio, puntos del servidor", () => {
  const [q] = buildQualificationQuestions([m()], NOW);
  assert.ok(q);
  assert.equal(q.kind, "advance");
  assert.equal(q.matchId, "d");
  assert.match(q.prompt, /Quién se clasifica/);
  assert.deepEqual(q.options, [{ key: "a", label: "Paper Rex" }, { key: "b", label: "Team Heretics" }]);
  assert.equal(q.locksAt, future(6));
  assert.equal(q.points, 10, "puntos por ronda, configurados en el servidor");
});

test("37 · UNKNOWN (sin winner_qualifies o sin CONFIRMED) e INFERRED no generan la pregunta", () => {
  assert.equal(buildQualificationQuestions([m({ winner_qualifies: null })], NOW).length, 0);
  assert.equal(buildQualificationQuestions([m({ progression_confidence: null })], NOW).length, 0);
  assert.equal(buildQualificationQuestions([m({ progression_confidence: "INFERRED" })], NOW).length, 0);
});

test("TBD · sin los dos equipos, o ya empezado, no hay pregunta (no se inventan participantes)", () => {
  assert.equal(buildQualificationQuestions([m({ team_b: null })], NOW).length, 0);
  assert.equal(buildQualificationQuestions([m({ status: "live" })], NOW).length, 0);
  assert.equal(buildQualificationQuestions([m({ start_time: new Date(NOW - 1000).toISOString() })], NOW).length, 0);
});

test("38 · idempotente: la misma entrada produce la misma pregunta, con clave estable (partido + tipo)", () => {
  assert.deepEqual(buildQualificationQuestions([m()], NOW), buildQualificationQuestions([m()], NOW));
});

test("40 · el corrector usa el resultado real del partido: se clasifica el ganador", () => {
  const jugado = m({ status: "finished", winner_team: "Team Heretics" });
  assert.equal(correctOptionForKind("advance", jugado), "b");
  assert.equal(correctOptionForKind("advance", m()), null, "sin ganador, pendiente");
});
