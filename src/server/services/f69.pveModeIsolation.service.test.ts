/**
 * F69 · AISLAMIENTO PvE ↔ PvP en `duel_matches`. Hallado en la sesión larga de la regresión F69: la cuenta QA E tenía
 * duelos PVP_PRIVATE sin terminar (del soak de F66); la partida rápida los RETOMABA por `getActiveMatch`, y cada jugada
 * pedía al bot PvE que respondiera por el rival humano → 80 × 500 «El oponente no pudo responder». Por la misma
 * rendija, `abandonMatch` (PvE) hacía DELETE de un duelo PvP en curso del jugador A y `playTurn` intentaba jugar el
 * turno del rival. Ahora, para el servicio PvE, un duelo PvP no existe (404 uniforme) y nunca se borra.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame";
import { MemSupabase } from "./testing/memSupabase";
import { startMatch, playTurn, abandonMatch, getMatch, getActiveMatch } from "./duels";

const U = "aaaaaaaa-0000-4000-8000-000000000069";
const B = "bbbbbbbb-0000-4000-8000-000000000069";
const DECK = "dddd0000-0000-4000-8000-000000000069";
const uid = (i: number) => `cccc0000-0000-4000-8000-${String(i).padStart(12, "0")}`;

function seed(): MemSupabase {
  const db = new MemSupabase();
  db.table("profiles").push({ id: U, username: "qa69", credits: 1000, xp: 0, level: 1 });
  const used = new Set<string>(); const team: string[] = [];
  for (const role of DUEL_ROLES) {
    let n = 0;
    for (const c of CARDS.filter((x) => x.combat && (x.role ?? getPlayer(x.playerId)?.role) === role)) {
      if (n === 2) break;
      if (used.has(c.playerId)) continue;
      used.add(c.playerId); n++;
      const u = uid(team.length);
      db.table("user_cards").push({ uid: u, user_id: U, card_id: c.id, serial: null, origin: "pack", locked: false, obtained_at: new Date(0).toISOString() });
      team.push(u);
    }
  }
  const at = new Date(0).toISOString();
  db.table("duel_decks").push({ id: DECK, user_id: U, name: "Equipo", card_uids: team, created_at: at, updated_at: at });
  return db;
}

/** Convierte la partida recién creada en un duelo PvP en curso donde U es el jugador A (forma real de la tabla). */
function asPvp(db: MemSupabase, matchId: string, mode: "PVP" | "PVP_PRIVATE") {
  const row = db.table("duel_matches").find((r: Record<string, unknown>) => r.id === matchId)!;
  Object.assign(row, { mode, player_b_id: B, updated_at: new Date(Date.now() + 1000).toISOString() });
}

for (const mode of ["PVP", "PVP_PRIVATE"] as const) {
  test(`F69 · partida rápida y duelo ${mode} en curso: el PvE no lo retoma, no lo juega, no lo lee y NO lo borra`, async () => {
    const db = seed();
    const s = await startMatch(db.client, U, DECK, "NORMAL");
    assert.ok(s.ok, s.error);
    const v = s.data!.view;
    asPvp(db, v.matchId, mode);

    const active = await getActiveMatch(db.client, U);
    assert.ok(active.ok);
    assert.equal(active.data!.view, null, "la partida rápida no retoma un duelo PvP");

    const card = v.yourHand[0].uid;
    const p = await playTurn(db.client, U, v.matchId, card, v.youAreAttacker ? "stronghold" : undefined);
    assert.equal(p.ok, false); assert.equal(p.status, 404, "el bot PvE nunca juega el turno de un humano");

    const g = await getMatch(db.client, U, v.matchId);
    assert.equal(g.ok, false); assert.equal(g.status, 404);

    await abandonMatch(db.client, U, v.matchId);
    const still = db.table("duel_matches").find((r: Record<string, unknown>) => r.id === v.matchId);
    assert.ok(still, "abandonar desde el PvE no borra un duelo PvP");
    assert.equal(still!.status, "IN_PROGRESS");
  });
}

test("F69 · con un duelo PvP en curso MÁS RECIENTE, la partida rápida sigue retomando su PvE", async () => {
  const db = seed();
  const pve = await startMatch(db.client, U, DECK, "NORMAL");
  assert.ok(pve.ok);
  // Otra fila, PvP y más reciente (copia de forma), del mismo jugador A.
  const src = db.table("duel_matches").find((r: Record<string, unknown>) => r.id === pve.data!.view.matchId)!;
  db.table("duel_matches").push({ ...src, id: "eeeeeeee-0000-4000-8000-000000000069", mode: "PVP_PRIVATE", player_b_id: B, updated_at: new Date(Date.now() + 5000).toISOString() });
  const active = await getActiveMatch(db.client, U);
  assert.equal(active.data!.view?.matchId, pve.data!.view.matchId);
});

test("F69 · el PvE de siempre intacto: se retoma, se juega y se abandona", async () => {
  const db = seed();
  const s = await startMatch(db.client, U, DECK, "NORMAL");
  const v = s.data!.view;
  assert.equal((await getActiveMatch(db.client, U)).data!.view?.matchId, v.matchId);
  const p = await playTurn(db.client, U, v.matchId, v.yourHand[0].uid, v.youAreAttacker ? "stronghold" : undefined);
  assert.ok(p.ok, p.error);
  const a = await abandonMatch(db.client, U, v.matchId);
  assert.ok(a.ok);
  assert.equal(db.table("duel_matches").find((r: Record<string, unknown>) => r.id === v.matchId), undefined);
});
