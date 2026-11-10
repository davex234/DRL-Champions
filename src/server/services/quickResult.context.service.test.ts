/**
 * RESULTADO DE PARTIDA RÁPIDA · el CONTEXTO CANÓNICO lo da el servidor con la BD, y los pagos no cambian.
 *
 *   · una partida rápida terminada → `context: "QUICK"` (en la jugada final y al releerla con F5);
 *   · la misma partida reclamada por un intento de Road to Champions → `"CAMPAIGN"`;
 *   · una fila de Draft Gauntlet → `"DRAFT"`;
 *   · en curso → sin contexto; si la lectura falla → sin contexto (el cliente enseña el resultado completo);
 *   · la partida rápida sigue pagando EXACTAMENTE igual (créditos/XP en el libro, una vez por partida).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame";
import { MemSupabase } from "./testing/memSupabase";
import { startMatch, playTurn, getMatch } from "./duels";
import type { DuelMatchView } from "@/lib/duel/types";

const U = "aaaaaaaa-0000-4000-8000-00000000a51c";
const DECK = "dddd0000-0000-4000-8000-00000000a51c";
const uid = (i: number) => `cccc0000-0000-4000-8000-${String(i).padStart(12, "0")}`;

function seed(): MemSupabase {
  const db = new MemSupabase();
  db.table("profiles").push({ id: U, username: "qaquick", credits: 1000, xp: 0, level: 1 });
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

const move = (v: DuelMatchView) => ({ card: v.yourHand[0].uid, stat: v.youAreAttacker ? "stronghold" : undefined });

async function playOut(db: MemSupabase): Promise<{ first: DuelMatchView; last: DuelMatchView; inProgress: DuelMatchView[] }> {
  const s = await startMatch(db.client, U, DECK, "NORMAL");
  assert.ok(s.ok, s.error);
  let v = s.data!.view;
  const first = v;
  const inProgress: DuelMatchView[] = [v];
  for (let k = 0; k < 20 && v.status === "IN_PROGRESS"; k++) {
    const m = move(v);
    const r = await playTurn(db.client, U, v.matchId, m.card, m.stat);
    assert.ok(r.ok, r.error);
    v = r.data!.view;
    if (v.status === "IN_PROGRESS") inProgress.push(v);
  }
  assert.notEqual(v.status, "IN_PROGRESS", "la partida terminó");
  return { first, last: v, inProgress };
}

test("QR-S1 · partida rápida terminada: QUICK en la jugada final y al releerla (F5); en curso, sin contexto", async () => {
  const db = seed();
  const { last, inProgress } = await playOut(db);
  assert.equal(last.context, "QUICK");
  for (const v of inProgress) assert.equal(v.context, undefined, "mientras se juega no hay contexto (ni lectura extra)");
  const again = await getMatch(db.client, U, last.matchId);
  assert.ok(again.ok);
  assert.equal(again.data!.view.context, "QUICK", "recargar el resultado conserva el contexto");
});

test("QR-S2 · la MISMA partida reclamada por un intento de Road to Champions → CAMPAIGN (no se simplifica)", async () => {
  const db = seed();
  const { last } = await playOut(db);
  db.table("campaign_attempts").push({ id: "att-1", user_id: U, campaign_id: "road-to-champions", node_id: "c1-n1", match_id: last.matchId, status: "SETTLED" });
  const g = await getMatch(db.client, U, last.matchId);
  assert.equal(g.data!.view.context, "CAMPAIGN");
});

test("QR-S3 · una fila de Draft Gauntlet → DRAFT", async () => {
  const db = seed();
  const { last } = await playOut(db);
  const row = db.table("duel_matches").find((r: Record<string, unknown>) => r.id === last.matchId)!;
  row.mode = "DRAFT_GAUNTLET";
  const g = await getMatch(db.client, U, last.matchId);
  assert.equal(g.data!.view.context, "DRAFT");
});

test("QR-S4 · la partida rápida PAGA igual que antes: un asiento por partida en el libro (el cambio es solo de pantalla)", async () => {
  const db = seed();
  const { last } = await playOut(db);
  const refs = db.table("credit_transactions").map((t: Record<string, unknown>) => String(t.ref ?? ""));
  assert.ok(refs.some((r) => r.includes(last.matchId)), "el abono de la partida existe (clave por partida)");
  await getMatch(db.client, U, last.matchId);
  await getMatch(db.client, U, last.matchId);
  const after = db.table("credit_transactions").map((t: Record<string, unknown>) => String(t.ref ?? "")).filter((r) => r.includes(last.matchId));
  assert.equal(after.length, refs.filter((r) => r.includes(last.matchId)).length, "releer el resultado no vuelve a pagar");
});
