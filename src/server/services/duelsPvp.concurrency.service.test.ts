/**
 * F66 · CONCURRENCIA Y AUTORIDAD PvP — el servicio real (`applyPvpAction`, `abandonPvpMatch`, `syncPvpMatch`) sobre
 * MemSupabase, donde cada consulta es atómica y el `await` entre leer y escribir es el hueco real de producción.
 *
 * La prueba contra Postgres de verdad (dos clientes, API real) está en `scripts/multiplayer/_fase66-e2e.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame";
import { MemSupabase } from "./testing/memSupabase";
import { createPvpMatch, applyPvpAction, abandonPvpMatch, syncPvpMatch, type PvpMatchView } from "./duelsPvp";

const A = "aaaaaaaa-0000-4000-8000-00000000066a";
const B = "bbbbbbbb-0000-4000-8000-00000000066b";
const C = "cccccccc-0000-4000-8000-00000000066c";
let seq = 0;
const uid = () => `eeee0000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;

function giveDeck(db: MemSupabase, user: string, offset: number): string {
  const used = new Set<string>(); const team: string[] = [];
  for (const role of DUEL_ROLES) {
    let n = 0, skip = offset;
    for (const c of CARDS.filter((x) => x.combat && (x.role ?? getPlayer(x.playerId)?.role) === role)) {
      if (n === 2) break;
      if (used.has(c.playerId)) continue;
      if (skip-- > 0) continue;
      used.add(c.playerId); n++;
      const u = uid();
      db.table("user_cards").push({ uid: u, user_id: user, card_id: c.id, serial: null, origin: "pack", locked: false, obtained_at: new Date(0).toISOString() });
      team.push(u);
    }
  }
  const id = randomUUID(); const at = new Date(0).toISOString();
  db.table("duel_decks").push({ id, user_id: user, name: "Equipo", card_uids: team, created_at: at, updated_at: at });
  return id;
}

async function newMatch() {
  const db = new MemSupabase();
  const da = giveDeck(db, A, 0), db_ = giveDeck(db, B, 3);
  const c = await createPvpMatch(db.client, { playerId: A, deckId: da }, { playerId: B, deckId: db_ }, { turnMs: null });
  assert.ok(c.ok, c.error);
  return { db, matchId: c.data!.view.matchId };
}

/** Estado actual para un jugador (ya proyectado). */
async function viewOf(db: MemSupabase, player: string, matchId: string) {
  const s = await syncPvpMatch(db.client, player, matchId);
  assert.ok(s.ok, s.error);
  return (s.data as unknown as { snapshot: PvpMatchView & { expectedSide: "A" | "B" | null } }).snapshot;
}
/** Quién debe actuar, traducido del bando publicado (el servidor no publica ids de usuario). */
const actor = (v: { expectedSide: "A" | "B" | null }) => (v.expectedSide === "A" ? A : B);

/** Una jugada legal para quien le toca, desde SU vista redactada. */
async function legal(db: MemSupabase, matchId: string, k = 0) {
  const who = actor(await viewOf(db, A, matchId));
  const v = await viewOf(db, who, matchId);
  const mine = v.yourSide === "A" ? v.match.snapshotA : v.match.snapshotB;
  const used = new Set(v.yourSide === "A" ? v.match.usedA : v.match.usedB);
  const hand = mine.cards.filter((c) => !used.has(c.uid));
  const attacking = v.match.attacker === v.yourSide;
  return { who, version: v.stateVersion, cardUid: hand[k % hand.length].uid, stat: attacking ? "stronghold" : undefined };
}

test("F66 PvP · diez jugadas concurrentes del mismo jugador y turno: UNA transición; el resto 409 con estado", async () => {
  const { db, matchId } = await newMatch();
  const moves = await Promise.all(Array.from({ length: 10 }, (_, k) => legal(db, matchId, k)));
  const rs = await Promise.all(moves.map((m) => applyPvpAction(db.client, matchId, { actionId: randomUUID(), expectedVersion: m.version, playerId: m.who, cardUid: m.cardUid, stat: m.stat })));
  assert.equal(rs.filter((r) => r.ok).length, 1);
  for (const r of rs.filter((x) => !x.ok)) { assert.equal(r.status, 409); assert.ok(r.data?.sync, "el 409 trae el estado para resincronizar"); }
  const after = await viewOf(db, A, matchId);
  assert.equal(after.stateVersion, moves[0].version + 1, "la versión avanzó UNA vez");
});

test("F66 PvP · reintento con la MISMA actionId (respuesta perdida, cinco a la vez): éxito idempotente, una transición", async () => {
  const { db, matchId } = await newMatch();
  const m = await legal(db, matchId);
  const actionId = randomUUID();
  const rs = await Promise.all(Array.from({ length: 5 }, () => applyPvpAction(db.client, matchId, { actionId, expectedVersion: m.version, playerId: m.who, cardUid: m.cardUid, stat: m.stat })));
  assert.ok(rs.filter((r) => r.ok).length >= 1);
  assert.ok(rs.every((r) => r.ok || r.status === 409));
  const late = await applyPvpAction(db.client, matchId, { actionId, expectedVersion: m.version, playerId: m.who, cardUid: m.cardUid, stat: m.stat });
  assert.ok(late.ok, "un reintento posterior es un éxito, no un error");
  assert.equal((await viewOf(db, A, matchId)).stateVersion, m.version + 1);
  assert.equal(db.table("duel_match_actions").filter((r) => r.action_id === actionId).length, 1);
});

test("F66 PvP · pestaña vieja (versión anterior) y fuera de orden: rechazada con el estado actual, sin corromper", async () => {
  const { db, matchId } = await newMatch();
  const m1 = await legal(db, matchId);
  assert.ok((await applyPvpAction(db.client, matchId, { actionId: randomUUID(), expectedVersion: m1.version, playerId: m1.who, cardUid: m1.cardUid, stat: m1.stat })).ok);
  // La pestaña B del MISMO jugador aún cree estar en la versión anterior.
  const stale = await applyPvpAction(db.client, matchId, { actionId: randomUUID(), expectedVersion: m1.version, playerId: m1.who, cardUid: m1.cardUid, stat: m1.stat });
  assert.equal(stale.status, 409);
  assert.equal(stale.data?.sync && (stale.data.sync as { stateVersion: number }).stateVersion, m1.version + 1);
  // Una jugada "del futuro" (versión que aún no existe) tampoco entra.
  const m2 = await legal(db, matchId);
  const future = await applyPvpAction(db.client, matchId, { actionId: randomUUID(), expectedVersion: m2.version + 5, playerId: m2.who, cardUid: m2.cardUid, stat: m2.stat });
  assert.equal(future.status, 409);
  assert.equal((await viewOf(db, A, matchId)).stateVersion, m1.version + 1);
});

test("F66 PvP · IDOR: un tercero no lee, no juega ni abandona (404 sin estado)", async () => {
  const { db, matchId } = await newMatch();
  const m = await legal(db, matchId);
  const read = await syncPvpMatch(db.client, C, matchId);
  const play = await applyPvpAction(db.client, matchId, { actionId: randomUUID(), expectedVersion: m.version, playerId: C, cardUid: m.cardUid, stat: m.stat });
  const ab = await abandonPvpMatch(db.client, C, matchId);
  for (const r of [read, play, ab]) { assert.equal(r.status, 404); assert.equal(r.data, undefined); }
  // Un id inexistente responde igual que uno ajeno: no hay oráculo de existencia.
  assert.equal((await syncPvpMatch(db.client, C, randomUUID())).status, 404);
});

test("F66 PvP · el que NO tiene el turno no puede actuar (ni con la versión correcta)", async () => {
  const { db, matchId } = await newMatch();
  const m = await legal(db, matchId);
  const other = m.who === A ? B : A;
  const r = await applyPvpAction(db.client, matchId, { actionId: randomUUID(), expectedVersion: m.version, playerId: other, cardUid: m.cardUid, stat: "stronghold" });
  assert.equal(r.status, 409);
  assert.equal(r.code, "NOT_YOUR_TURN");
});

test("F66 PvP · jugar contra abandonar a la vez: o la jugada o el abandono, nunca las dos", async () => {
  for (let i = 0; i < 8; i++) {
    const { db, matchId } = await newMatch();
    const m = await legal(db, matchId);
    const quitter = i % 2 ? m.who : (m.who === A ? B : A);
    const [p, a] = await Promise.all([
      applyPvpAction(db.client, matchId, { actionId: randomUUID(), expectedVersion: m.version, playerId: m.who, cardUid: m.cardUid, stat: m.stat }),
      abandonPvpMatch(db.client, quitter, matchId),
    ]);
    const row = db.table("duel_matches").find((r) => r.id === matchId)!;
    assert.equal(p.ok && a.ok, false, "no ganan las dos");
    if (a.ok) { assert.equal(row.closed_reason, "ABANDONED"); assert.equal(row.state_version, m.version + 1); }
    if (p.ok) { assert.equal(row.closed_reason, null); assert.equal(row.state_version, m.version + 1); }
  }
});

test("F66 PvP · abandonar dos veces / diez a la vez: un cierre, el primer motivo es el que vale", async () => {
  const { db, matchId } = await newMatch();
  const rs = await Promise.all(Array.from({ length: 10 }, (_, k) => abandonPvpMatch(db.client, k % 2 ? A : B, matchId)));
  assert.equal(rs.filter((r) => r.ok).length, 1);
  const row = db.table("duel_matches").find((r) => r.id === matchId)!;
  assert.equal(row.closed_reason, "ABANDONED");
  assert.equal(row.state_version, 1);
});

test("F66 PvP · la mano del rival no viaja: ni en el sondeo ni en el 409", async () => {
  const { db, matchId } = await newMatch();
  const vA = await viewOf(db, A, matchId);
  const rivalSnap = vA.yourSide === "A" ? vA.match.snapshotB : vA.match.snapshotA;
  assert.equal(rivalSnap.cards.length, 0, "cartas no jugadas del rival: ninguna");
  const m = await legal(db, matchId);
  const other = m.who === A ? B : A;
  const r = await applyPvpAction(db.client, matchId, { actionId: randomUUID(), expectedVersion: m.version, playerId: other, cardUid: m.cardUid, stat: "stronghold" });
  const snap = (r.data?.sync as unknown as { snapshot: PvpMatchView }).snapshot;
  const theirs = snap.yourSide === "A" ? snap.match.snapshotB : snap.match.snapshotA;
  assert.equal(theirs.cards.length, 0);
});
