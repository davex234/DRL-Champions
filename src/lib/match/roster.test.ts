/**
 * Tests del Match Roster (node:test, sin dependencias nuevas).
 * Ejecutar: `npx tsx --test src/lib/match/roster.test.ts`.
 *
 * Regresión R5 (PVP Readiness Audit): `buildRivalRoster` reventaba con
 * `TypeError: Cannot read properties of undefined (reading 'id')` cuando la selección
 * incluía un jugador con `cardsForPlayer(player) === []` (no elegible, sin métricas).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { allPlayers, cardsForPlayer } from "@/data/catalog";
import { buildRivalRoster, buildMatchRosters } from "./roster";

const SEEDS = Array.from({ length: 200 }, (_, i) => i);

test("el catálogo REAL contiene jugadores sin cartas (el caso que rompía)", () => {
  const noCards = allPlayers().filter((p) => cardsForPlayer(p).length === 0);
  assert.ok(
    noCards.length > 0,
    "fixture invalidado: si el catálogo ya no tiene jugadores no elegibles, este test deja de cubrir R5",
  );
});

test("buildRivalRoster nunca elige un jugador sin cartas, en ninguna dificultad", () => {
  const noCards = new Set(allPlayers().filter((p) => cardsForPlayer(p).length === 0).map((p) => p.id));
  for (const difficulty of ["easy", "normal", "hard"] as const) {
    for (const seed of SEEDS) {
      const roster = buildRivalRoster(seed, new Set(), difficulty);
      assert.equal(roster.length, 5, `${difficulty}/${seed}: el rival debe ser de 5`);
      for (const entry of roster) {
        const playerId = entry.meta?.playerId;
        assert.ok(playerId, `${difficulty}/${seed}: la entrada debe traer playerId`);
        assert.ok(!noCards.has(playerId), `${difficulty}/${seed}: ${playerId} no tiene cartas`);
      }
    }
  }
});

test("buildRivalRoster sigue siendo determinista por seed y respeta exclude", () => {
  assert.deepEqual(buildRivalRoster(7), buildRivalRoster(7));
  assert.notDeepEqual(buildRivalRoster(7), buildRivalRoster(8));

  const base = buildRivalRoster(7);
  const excluded = base.map((e) => e.meta!.playerId as string);
  const other = buildRivalRoster(7, new Set(excluded));
  assert.equal(other.length, 5);
  for (const entry of other) assert.ok(!excluded.includes(entry.meta!.playerId as string));
});

test("buildMatchRosters produce 5v5 sin solaparse (camino de producción)", () => {
  const { rosters } = buildMatchRosters([], [], 123);
  assert.equal(rosters.home.length, 0);
  assert.equal(rosters.away.length, 5);
});
