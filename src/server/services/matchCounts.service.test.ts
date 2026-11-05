/**
 * CORE GAME LOOP · «PARTIDAS QUE CUENTAN» — PvE + ranked en los dos asientos; ni privadas, ni torneos, ni Draft.
 * Y que las cuatro lecturas que lo usan (pase, eventos, vestíbulo, recorrido) ya no cuentan a mano.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeSupabase } from "./testing/fakeSupabase";
import { countPlayedMatches, countWonMatches } from "./matchCounts";
import { loadFacts } from "./progression";

const A = "aaaaaaaa-0000-4000-8000-0000000c0001";
const B = "bbbbbbbb-0000-4000-8000-0000000c0002";
const C = "cccccccc-0000-4000-8000-0000000c0003";
const at = (d: string) => `2026-10-0${d}T12:00:00.000Z`;

function db() {
  const f = new FakeSupabase();
  f.tables = {
    duel_matches: [
      // PvE: el humano es A.
      { id: "pve-win", mode: "PVE", user_id: A, player_b_id: null, status: "COMPLETED", winner: "A", created_at: at("5"), updated_at: at("5") },
      { id: "pve-loss", mode: "PVE", user_id: A, player_b_id: null, status: "COMPLETED", winner: "B", created_at: at("6"), updated_at: at("6") },
      { id: "pve-draw", mode: "PVE", user_id: A, player_b_id: null, status: "DRAW", winner: null, created_at: at("6"), updated_at: at("6") },
      { id: "pve-open", mode: "PVE", user_id: A, player_b_id: null, status: "IN_PROGRESS", winner: null, created_at: at("6"), updated_at: at("6") },
      // Ranked: A contra B, gana B (el asiento B progresa).
      { id: "rk-1", mode: "PVP", user_id: A, player_b_id: B, status: "COMPLETED", winner: "B", created_at: at("6"), updated_at: at("6") },
      // Ranked: C contra A, gana A desde el asiento B.
      { id: "rk-2", mode: "PVP", user_id: C, player_b_id: A, status: "COMPLETED", winner: "B", created_at: at("7"), updated_at: at("7") },
      // Privada y torneo (PVP_PRIVATE) y Draft: no cuentan para nadie.
      { id: "pr-1", mode: "PVP_PRIVATE", user_id: A, player_b_id: B, status: "COMPLETED", winner: "A", created_at: at("7"), updated_at: at("7") },
      { id: "pr-2", mode: "PVP_PRIVATE", user_id: B, player_b_id: A, status: "COMPLETED", winner: "B", created_at: at("7"), updated_at: at("7") },
      { id: "dr-1", mode: "DRAFT_GAUNTLET", user_id: A, player_b_id: null, status: "COMPLETED", winner: "A", created_at: at("7"), updated_at: at("7") },
    ],
  };
  return f;
}

test("PvE + ranked en los dos asientos: jugadas y ganadas del asiento propio", async () => {
  const f = db();
  assert.deepEqual(await countPlayedMatches(f.client, A), { count: 5, error: null }); // 3 PvE terminadas + rk-1 + rk-2
  assert.deepEqual(await countWonMatches(f.client, A), { count: 2, error: null }); // pve-win + rk-2 (asiento B)
  assert.deepEqual(await countPlayedMatches(f.client, B), { count: 1, error: null }); // rk-1 como B; las privadas no
  assert.deepEqual(await countWonMatches(f.client, B), { count: 1, error: null });
  assert.deepEqual(await countWonMatches(f.client, C), { count: 0, error: null });
});

test("privadas, torneos y Draft no suman nada a nadie (ni el asiento A ni el B)", async () => {
  const f = db();
  f.tables.duel_matches = f.tables.duel_matches.filter((r) => r.mode === "PVP_PRIVATE" || r.mode === "DRAFT_GAUNTLET");
  for (const u of [A, B]) {
    assert.equal((await countPlayedMatches(f.client, u)).count, 0);
    assert.equal((await countWonMatches(f.client, u)).count, 0);
  }
});

test("ventana: acota por la columna pedida, en los dos asientos", async () => {
  const f = db();
  const w = { column: "updated_at" as const, from: at("6") };
  assert.equal((await countPlayedMatches(f.client, A, w)).count, 4); // pve-loss, pve-draw, rk-1, rk-2
  assert.equal((await countWonMatches(f.client, A, w)).count, 1); // rk-2
  const e = { column: "created_at" as const, from: at("5"), to: at("6") };
  assert.equal((await countPlayedMatches(f.client, A, e)).count, 4); // pve-win, pve-loss, pve-draw, rk-1
});

test("un error de lectura no se convierte en un 0 silencioso", async () => {
  const f = db();
  f.failTables.add("duel_matches");
  const r = await countPlayedMatches(f.client, A);
  assert.equal(r.count, null);
  assert.ok(r.error);
});

test("el pase lee la misma definición (loadFacts): duels_played / duels_won", async () => {
  const f = db();
  Object.assign(f.tables, {
    profiles: [{ id: A, packs_opened: 0, points: 0, region: null, created_at: at("1") }],
    user_cards: [], duel_decks: [], pickem_submissions: [], user_game: [],
  });
  const facts = await loadFacts(f.client, A);
  assert.equal(facts.metrics.duels_played, 5);
  assert.equal(facts.metrics.duels_won, 2);
});

test("contrato: pase, eventos, vestíbulo y recorrido cuentan con `matchCounts`, no a mano", () => {
  const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  for (const p of ["progression", "events", "loop", "onboarding"]) {
    const s = code(`src/server/services/${p}.ts`);
    assert.match(s, /from "\.\/matchCounts"/, p);
    assert.doesNotMatch(s, /neq\("mode", "DRAFT_GAUNTLET"\)/, `${p}: recuento a mano`);
    assert.doesNotMatch(s, /eq\("winner", "A"\)/, `${p}: victoria solo del asiento A`);
  }
});
