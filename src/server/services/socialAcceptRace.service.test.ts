/**
 * FULL GAME AUDIT (2026-10-07) · CARRERA DE ACEPTACIONES SIMULTÁNEAS DE UN RETO (deuda F85, reproducida en producción:
 * 5 aceptaciones a la vez → una 500 MATCH_FAILED en 2 de 4 rondas, con UNA sola partida creada).
 *
 * La petición que reservó el reto (ACCEPTED) y otra que llegó a la vez (ALREADY_ACCEPTED sin partida aún) crean la MISMA
 * partida con el MISMO id; la clave primaria deja una. La que pierde no puede: responder 500, ni llamar a
 * `social_challenge_fail` (cancelaría un reto cuya partida existe, y `mark_matched` ya no lo arreglaría).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame";
import { MemorySupabase, type Row } from "./testing/memorySupabase";
import { respondChallenge } from "./social";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CHALLENGER = id(11), ME = id(12), CH = id(801), MATCH = id(901), DECK_A = id(701), DECK_B = id(702);

function legalTeam(db: MemorySupabase, owner: string, base: number): string[] {
  const used = new Set<string>(); const uids: string[] = [];
  for (const role of DUEL_ROLES) {
    let n = 0;
    for (const c of CARDS.filter((x) => x.combat && (x.role ?? getPlayer(x.playerId)?.role) === role)) {
      if (n === 2) break;
      if (used.has(c.playerId)) continue;
      used.add(c.playerId); n++;
      const uid = id(base + uids.length);
      db.tables.user_cards.push({ uid, user_id: owner, card_id: c.id, serial: null, origin: "pack", locked: false, obtained_at: new Date(0).toISOString() });
      uids.push(uid);
    }
  }
  return uids;
}

function world(outcome: "ACCEPTED" | "ALREADY_ACCEPTED", matchAlreadyThere: boolean) {
  const db = new MemorySupabase();
  db.tables.user_cards = [];
  const at = new Date(0).toISOString();
  db.tables.duel_decks = [
    { id: DECK_A, user_id: CHALLENGER, name: "A", card_uids: legalTeam(db, CHALLENGER, 100), created_at: at, updated_at: at },
    { id: DECK_B, user_id: ME, name: "B", card_uids: legalTeam(db, ME, 200), created_at: at, updated_at: at },
  ];
  db.tables.duel_challenges = [{ id: CH, challenger_id: CHALLENGER, challenged_id: ME, status: "ACCEPTED", match_id: MATCH }];
  db.tables.duel_matches = matchAlreadyThere
    ? [{ id: MATCH, mode: "PVP_PRIVATE", user_id: CHALLENGER, player_b_id: ME, status: "IN_PROGRESS" } as Row]
    : [];
  db.unique.duel_matches = [{ cols: ["id"] }];
  db.rpcHandlers.social_challenge_respond = () => ({ data: { code: outcome, matchId: MATCH, status: "ACCEPTED", challengerId: CHALLENGER, challengerDeckId: DECK_A, challengedDeckId: DECK_B }, error: null });
  db.rpcHandlers.social_challenge_mark_matched = () => { db.tables.duel_challenges[0].status = "MATCHED"; return { data: { code: "MATCHED" }, error: null }; };
  db.rpcHandlers.social_challenge_fail = () => { db.tables.duel_challenges[0].status = "CANCELLED"; return { data: { code: "CANCELLED" }, error: null }; };
  return db;
}

test("AUDIT-SOC-1 · ACCEPTED que pierde la creación (la otra petición ya creó ESA partida): MATCHED controlado, sin 500 ni cancelar", async () => {
  const db = world("ACCEPTED", true);
  const r = await respondChallenge(db.client, ME, { challengeId: CH, accept: true, deckId: DECK_B });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data?.matchId, MATCH);
  assert.equal(r.data?.status, "MATCHED");
  assert.equal(db.tables.duel_challenges[0].status, "MATCHED", "el reto queda emparejado, nunca cancelado");
  assert.ok(!db.rpcCalls.some((c) => c.name === "social_challenge_fail"));
  assert.equal(db.tables.duel_matches.length, 1, "una sola partida");
});

test("AUDIT-SOC-2 · ACCEPTED sin carrera: crea la partida y empareja (camino normal intacto)", async () => {
  const db = world("ACCEPTED", false);
  const r = await respondChallenge(db.client, ME, { challengeId: CH, accept: true, deckId: DECK_B });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(db.tables.duel_matches.length, 1);
  assert.equal(db.tables.duel_challenges[0].status, "MATCHED");
});

test("AUDIT-SOC-3 · ALREADY_ACCEPTED: con la partida creada → MATCHED; si la creación falla y la partida NO existe → 409, nunca un MATCHED falso", async () => {
  const ok = world("ALREADY_ACCEPTED", true);
  const r1 = await respondChallenge(ok.client, ME, { challengeId: CH, accept: true, deckId: DECK_B });
  assert.equal(r1.ok, true); assert.equal(r1.data?.status, "MATCHED");
  const broken = world("ALREADY_ACCEPTED", false);
  broken.failing.add("duel_matches");
  const r2 = await respondChallenge(broken.client, ME, { challengeId: CH, accept: true, deckId: DECK_B });
  assert.equal(r2.ok, false); assert.equal(r2.status, 409); assert.equal((r2 as { code?: string }).code, "MATCH_PENDING");
});
