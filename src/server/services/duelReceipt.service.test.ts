/**
 * DUEL GAMEPLAY UX 2.0 · RECOMPENSAS OBTENIDAS = el RECIBO del servidor, no la tabla de premios.
 *
 *   · el resultado de una partida PvE trae `rewards` leído del libro mayor (`duel:<id>`): lo concedido, ni más ni menos;
 *   · una partida topada por el cupo diario no trae concesiones (cero recompensas → la sección no se pinta);
 *   · F5, URL directa y 20 lecturas a la vez devuelven el MISMO recibo y no conceden nada más;
 *   · el recibo de otra persona no se puede leer (404 uniforme);
 *   · en curso no hay recibo.
 * La primera victoria de campaña se comprueba en su clave (`firstClearRefForMatch`) en `campaign.service.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame";
import { DAILY_DUEL_AWARD_CAP } from "@/domain/progression/duelRewards";
import { MemSupabase } from "./testing/memSupabase";
import { startMatch, playTurn, getMatch } from "./duels";
import type { DuelMatchView } from "@/lib/duel/types";

const U = "aaaaaaaa-0000-4000-8000-0000000ec1b0";
const OTHER = "bbbbbbbb-0000-4000-8000-0000000ec1b1";
const DECK = "dddd0000-0000-4000-8000-0000000ec1b0";
const uid = (i: number) => `cccc0000-0000-4000-8000-${String(i).padStart(12, "0")}`;

function seed(): MemSupabase {
  const db = new MemSupabase();
  db.table("profiles").push({ id: U, username: "qareceipt", credits: 1000, xp: 0, level: 1 });
  db.table("profiles").push({ id: OTHER, username: "qaother", credits: 1000, xp: 0, level: 1 });
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

async function playOut(db: MemSupabase, level: "EASY" | "NORMAL" | "HARD" = "NORMAL"): Promise<DuelMatchView> {
  const s = await startMatch(db.client, U, DECK, level);
  assert.ok(s.ok, s.error);
  let v = s.data!.view;
  assert.equal(v.result, null, "en curso no hay recibo");
  for (let k = 0; k < 20 && v.status === "IN_PROGRESS"; k++) {
    const r = await playTurn(db.client, U, v.matchId, v.yourHand[0].uid, v.youAreAttacker ? "stronghold" : undefined);
    assert.ok(r.ok, r.error);
    v = r.data!.view;
  }
  assert.notEqual(v.status, "IN_PROGRESS");
  return v;
}

const ledgerOf = (db: MemSupabase, matchId: string) => db.table("credit_transactions").filter((t) => t.user_id === U && t.ref === `duel:${matchId}`);
const credits = (db: MemSupabase) => Number(db.table("profiles").find((p) => p.id === U)!.credits);

test("UX2 R1 · el recibo es el asiento REAL del libro mayor: créditos concedidos, XP y puntos de esa partida", async () => {
  const db = seed();
  const before = credits(db);
  const v = await playOut(db);
  const rw = v.result!.rewards!;
  assert.ok(rw, "la jugada que cierra la partida ya trae el recibo");
  assert.equal(rw.matchId, v.matchId);
  assert.equal(rw.capped, false);
  const [row] = ledgerOf(db, v.matchId);
  assert.ok(row, "hay asiento");
  const match = rw.grants.filter((g) => g.source === "MATCH");
  assert.equal(match.length, 1);
  assert.equal(match[0].reward.credits ?? 0, Number(row.delta), "créditos = los del asiento, no los de la tabla");
  assert.equal(credits(db) - before, Number(row.delta), "y son los que de verdad subió el saldo");
  assert.deepEqual(v.result!.award, { points: match[0].points, credits: match[0].reward.credits ?? 0, xp: match[0].reward.xp ?? 0 });
  // Ningún tipo inventado: una partida rápida solo concede créditos/XP/puntos.
  for (const g of rw.grants) assert.deepEqual(Object.keys(g.reward).filter((k) => !["credits", "xp"].includes(k)), []);
});

test("UX2 R2 · F5, URL directa y 20 lecturas A LA VEZ: el mismo recibo, un solo asiento, el saldo no se mueve", async () => {
  const db = seed();
  const v = await playOut(db);
  const after = credits(db);
  const reads = await Promise.all(Array.from({ length: 20 }, () => getMatch(db.client, U, v.matchId)));
  for (const r of reads) {
    assert.ok(r.ok, r.error);
    assert.deepEqual(r.data!.view.result!.rewards, v.result!.rewards);
    assert.deepEqual(r.data!.view.result!.award, v.result!.award);
  }
  assert.equal(ledgerOf(db, v.matchId).length, 1, "leer no concede");
  assert.equal(credits(db), after);
});

test("UX2 R3 · el recibo de OTRA persona no se lee: 404 uniforme, sin recibo", async () => {
  const db = seed();
  const v = await playOut(db);
  const r = await getMatch(db.client, OTHER, v.matchId);
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.ok(!JSON.stringify(r).includes("grants"));
});

test("UX2 R4 · partida TOPADA por el cupo diario: ninguna concesión (la sección no se pinta) y `capped`", async () => {
  const db = seed();
  let last: DuelMatchView | null = null;
  for (let i = 0; i <= DAILY_DUEL_AWARD_CAP; i++) last = await playOut(db, "EASY");
  const rw = last!.result!.rewards!;
  assert.match(String(ledgerOf(db, last!.matchId)[0]?.reason), /^duel_capped_/);
  assert.equal(rw.capped, true);
  assert.deepEqual(rw.grants, []);
  assert.equal(last!.result!.award, null, "ninguna cifra que no se concedió");
});

test("UX2 R5 · sin lectura fiable del libro no se enseña NADA (ni la tabla)", async () => {
  const db = seed();
  const v = await playOut(db);
  const real = db.client.from.bind(db.client);
  (db.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
    if (t !== "credit_transactions") return real(t);
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: { message: "ledger down" } }) };
    return q;
  };
  const r = await getMatch(db.client, U, v.matchId);
  assert.ok(r.ok, r.error);
  assert.equal(r.data!.view.result!.rewards, null);
  assert.equal(r.data!.view.result!.award, null);
});

test("UX2 R6 · primera victoria de campaña: va en el recibo (`rewards`), pero `award` sigue siendo SOLO lo de la partida", async () => {
  const db = seed();
  const v = await playOut(db);
  const [own] = ledgerOf(db, v.matchId);
  // La liquidación de campaña (su servicio, idempotente por la clave) dejó estas dos filas para ESTA partida.
  db.table("campaign_attempts").push({ id: "att-1", user_id: U, campaign_id: "road-to-champions", node_id: "c1-n1", match_id: v.matchId, status: "SETTLED", first_clear: true, reward_granted: true });
  db.table("credit_transactions").push({ id: "fc-1", user_id: U, delta: 200, reason: "campaign_first_clear", ref: "campaign:road-to-champions:c1-n1", balance_after: 0, kind: "credit", created_at: new Date().toISOString() });
  const r = await getMatch(db.client, U, v.matchId);
  assert.ok(r.ok, r.error);
  const rw = r.data!.view.result!.rewards!;
  assert.deepEqual(rw.grants.map((g) => g.source), ["MATCH", "CAMPAIGN_FIRST_CLEAR"]);
  assert.equal(rw.grants[1].reward.credits, 200, "la primera victoria, del libro mayor");
  assert.equal(r.data!.view.result!.award!.credits, Number(own.delta), "el panel de la partida no la suma: la enseña el aviso de campaña");
  // Otra persona con un intento de esa partida no existe: la clave se busca por (partida, dueño).
  db.table("campaign_attempts")[0].user_id = OTHER;
  const r2 = await getMatch(db.client, U, v.matchId);
  assert.deepEqual(r2.data!.view.result!.rewards!.grants.map((g) => g.source), ["MATCH"]);
});

test("CORE LOOP R6 · el recibo dice qué cupo diario ocupó la partida (1…20) y, con el tope agotado, `slot: null`", async () => {
  const db = seed();
  const views: DuelMatchView[] = [];
  for (let i = 0; i <= DAILY_DUEL_AWARD_CAP; i++) views.push(await playOut(db, "EASY"));
  views.slice(0, DAILY_DUEL_AWARD_CAP).forEach((v, i) => assert.deepEqual(v.result!.rewards!.daily, { slot: i + 1, cap: DAILY_DUEL_AWARD_CAP }, `partida ${i + 1}`));
  const last = views[DAILY_DUEL_AWARD_CAP];
  assert.deepEqual(last.result!.rewards!.daily, { slot: null, cap: DAILY_DUEL_AWARD_CAP });
  // F5: leer otra vez la partida 7 y la topada dice lo mismo y no gasta cupos (ni toca el libro).
  const ops = db.table("economy_ops").length;
  for (const v of [views[6], last]) {
    const r = await getMatch(db.client, U, v.matchId);
    assert.deepEqual(r.data!.view.result!.rewards!.daily, v.result!.rewards!.daily);
  }
  assert.equal(db.table("economy_ops").length, ops, "leer el recibo no escribe cupos");
});
