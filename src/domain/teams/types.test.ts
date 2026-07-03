/**
 * Tests de validación del Roster Builder (node:test, sin dependencias nuevas).
 * Ejecutar: `npx tsx --test src/domain/teams/types.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTeam, type CardRef, type Team } from "./types";

/** Colección simulada: uid → playerId. */
const COLLECTION: Record<string, string> = {
  u1: "aspas", u2: "less", u3: "saadhak", u4: "cauanzin", u5: "tuyz", u6: "aspas2", uDup: "aspas",
};
const resolve = (uid: string): CardRef | null =>
  COLLECTION[uid] ? { uid, playerId: COLLECTION[uid] } : null;

function team(over: Partial<Team> = {}): Team {
  return { id: "t", name: "Equipo", starters: [], subs: [], createdAt: 0, lastUsedAt: null, ...over };
}

test("un equipo de 5 cartas válidas no tiene errores", () => {
  const errs = validateTeam(team({ starters: ["u1", "u2", "u3", "u4", "u5"] }), resolve);
  assert.equal(errs.length, 0);
});

test("nombre vacío → EMPTY_NAME", () => {
  const errs = validateTeam(team({ name: "  ", starters: ["u1", "u2", "u3", "u4", "u5"] }), resolve);
  assert.ok(errs.some((e) => e.code === "EMPTY_NAME"));
});

test("menos de 5 titulares → NOT_ENOUGH_STARTERS", () => {
  const errs = validateTeam(team({ starters: ["u1", "u2"] }), resolve);
  assert.ok(errs.some((e) => e.code === "NOT_ENOUGH_STARTERS"));
});

test("carta repetida → DUPLICATE_CARD", () => {
  const errs = validateTeam(team({ starters: ["u1", "u1", "u2", "u3", "u4"] }), resolve);
  assert.ok(errs.some((e) => e.code === "DUPLICATE_CARD"));
});

test("dos cartas del mismo jugador → DUPLICATE_PLAYER", () => {
  // u1 y uDup son ambos "aspas".
  const errs = validateTeam(team({ starters: ["u1", "uDup", "u2", "u3", "u4"] }), resolve);
  assert.ok(errs.some((e) => e.code === "DUPLICATE_PLAYER"));
});

test("carta inexistente → UNKNOWN_CARD", () => {
  const errs = validateTeam(team({ starters: ["u1", "u2", "u3", "u4", "ZZZ"] }), resolve);
  assert.ok(errs.some((e) => e.code === "UNKNOWN_CARD"));
});
