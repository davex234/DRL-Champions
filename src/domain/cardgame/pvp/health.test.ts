/** F66 · salud del multijugador: detecta colgadas, doble asignación, autopartida y cola huérfana; en verde si no hay nada. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { multiplayerHealth } from "./health";

const NOW = Date.parse("2026-09-26T20:00:00Z");
const iso = (ms: number) => new Date(NOW + ms).toISOString();

test("F66 salud · sin incidencias: HEALTHY", () => {
  const h = multiplayerHealth([{ id: "m1", user_id: "a", player_b_id: "b", turn_deadline_at: iso(60_000), updated_at: iso(0) }], [{ id: "q1", user_id: "a", state: "MATCHED", match_id: "m1", pairing_expires_at: null }], new Set(["m1"]), NOW);
  assert.equal(h.level, "HEALTHY");
  assert.equal(h.liveMatches, 1);
});

test("F66 salud · colgada, doble asignación, autopartida, cola huérfana y emparejamiento atascado: WARNING", () => {
  const h = multiplayerHealth([
    { id: "old", user_id: "a", player_b_id: "b", turn_deadline_at: iso(-10 * 60_000), updated_at: iso(-11 * 60_000) },
    { id: "dup", user_id: "a", player_b_id: "c", turn_deadline_at: iso(60_000), updated_at: iso(0) },
    { id: "self", user_id: "d", player_b_id: "d", turn_deadline_at: iso(60_000), updated_at: iso(0) },
  ], [
    { id: "q-orphan", user_id: "e", state: "MATCHED", match_id: "nope", pairing_expires_at: null },
    { id: "q-stuck", user_id: "f", state: "PAIRING", match_id: null, pairing_expires_at: iso(-10 * 60_000) },
  ], new Set(), NOW);
  assert.equal(h.level, "WARNING");
  assert.deepEqual(h.stale, ["old"]);
  assert.equal(h.doubleAssigned, 2); // «a» en dos partidas y «d» dos veces en la misma
  assert.deepEqual(h.selfMatches, ["self"]);
  assert.deepEqual(h.orphanQueue, ["q-orphan"]);
  assert.deepEqual(h.stuckPairing, ["q-stuck"]);
});
