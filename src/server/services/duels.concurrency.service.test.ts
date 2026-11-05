/**
 * F66 · CONCURRENCIA PvE — dos jugadas simultáneas sobre el mismo turno no pueden aplicarse las dos.
 *
 * F65 (INT-1) lo documentó: `persist()` escribía sin condición, así que dos `play` que cargan la misma fila y
 * escriben después se pisaban (gana la última escritura). MemSupabase reproduce exactamente esa carrera: cada
 * consulta es atómica y el `await` entre leer y escribir es el hueco real de producción.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame";
import { MemSupabase } from "./testing/memSupabase";
import { startMatch, playTurn, abandonMatch, getMatch } from "./duels";

const U = "aaaaaaaa-0000-4000-8000-000000000066";
const DECK = "dddd0000-0000-4000-8000-000000000066";
const uid = (i: number) => `cccc0000-0000-4000-8000-${String(i).padStart(12, "0")}`;

function seed(): MemSupabase {
  const db = new MemSupabase();
  db.table("profiles").push({ id: U, username: "qa66", credits: 1000, xp: 0, level: 1 });
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

async function freshMatch(db: MemSupabase) {
  const s = await startMatch(db.client, U, DECK, "NORMAL");
  assert.ok(s.ok, s.error);
  return s.data!.view;
}

/** Jugada legal para la vista actual (carta `k` de la mano). */
const move = (v: { yourHand: { uid: string }[]; youAreAttacker: boolean }, k: number) =>
  ({ card: v.yourHand[k % v.yourHand.length].uid, stat: v.youAreAttacker ? "stronghold" : undefined });

test("F66 PvE · dos jugadas simultáneas del MISMO turno: exactamente una se aplica, la otra es 409 con el estado real", async () => {
  const db = seed();
  const v = await freshMatch(db);
  const a = move(v, 0), b = move(v, 1);
  const [r1, r2] = await Promise.all([
    playTurn(db.client, U, v.matchId, a.card, a.stat),
    playTurn(db.client, U, v.matchId, b.card, b.stat),
  ]);
  const oks = [r1, r2].filter((r) => r.ok);
  assert.equal(oks.length, 1, "una sola jugada gana");
  const loser = [r1, r2].find((r) => !r.ok)!;
  assert.equal(loser.status, 409);
  // Lo guardado es EXACTAMENTE lo que vio el ganador: un turno jugado, no dos, y nada pisado.
  const now = await getMatch(db.client, U, v.matchId);
  assert.equal(now.data!.view.history.length, oks[0].data!.view.history.length);
  assert.deepEqual(now.data!.view.yourUsed.map((c) => c.uid), oks[0].data!.view.yourUsed.map((c) => c.uid));
  // El perdedor recibe el estado actual para resincronizar (no un 500, no un vacío).
  assert.equal((loser as { data?: { view?: { matchId: string } } }).data?.view?.matchId, v.matchId);
});

test("F66 PvE · diez jugadas concurrentes (doble clic, Enter+clic, dos pestañas): un turno, nunca dos", async () => {
  const db = seed();
  const v = await freshMatch(db);
  const rs = await Promise.all(Array.from({ length: 10 }, (_, k) => { const m = move(v, k); return playTurn(db.client, U, v.matchId, m.card, m.stat); }));
  assert.equal(rs.filter((r) => r.ok).length, 1);
  assert.ok(rs.filter((r) => !r.ok).every((r) => r.status === 409));
});

test("F66 PvE · reintento tras respuesta perdida: la misma jugada repetida no se aplica dos veces", async () => {
  const db = seed();
  const v = await freshMatch(db);
  const m = move(v, 0);
  const first = await playTurn(db.client, U, v.matchId, m.card, m.stat);
  assert.ok(first.ok);
  const retry = await playTurn(db.client, U, v.matchId, m.card, m.stat);
  assert.equal(retry.ok, false);
  const now = await getMatch(db.client, U, v.matchId);
  assert.equal(now.data!.view.history.length, first.data!.view.history.length);
});

test("F66 PvE · jugar contra abandonar a la vez: o se jugó o se abandonó, nunca un híbrido que pague", async () => {
  for (let i = 0; i < 6; i++) {
    const db = seed();
    const v = await freshMatch(db);
    const m = move(v, 0);
    const [p, a] = i % 2
      ? await Promise.all([playTurn(db.client, U, v.matchId, m.card, m.stat), abandonMatch(db.client, U, v.matchId)])
      : await Promise.all([abandonMatch(db.client, U, v.matchId), playTurn(db.client, U, v.matchId, m.card, m.stat)]).then(([x, y]) => [y, x] as const);
    const row = db.table("duel_matches").find((r) => r.id === v.matchId);
    if (row) assert.ok(p.ok, "si la fila sigue, es porque la jugada ganó");
    else assert.ok(a.ok && !p.ok, "si se abandonó, la jugada no cuenta");
    assert.equal(db.table("credit_transactions").length, 0, "nadie cobra a mitad de partida");
  }
});

test("F66 PvE · abandonar una partida TERMINADA no la borra (ni su repetición ni su pago)", async () => {
  const db = seed();
  let v = await freshMatch(db);
  for (let k = 0; k < 20 && !v.result; k++) { const m = move(v, 0); const r = await playTurn(db.client, U, v.matchId, m.card, m.stat); assert.ok(r.ok, r.error); v = r.data!.view; }
  assert.ok(v.result, "la partida terminó");
  const ab = await abandonMatch(db.client, U, v.matchId);
  assert.equal(ab.ok, false);
  assert.equal(ab.status, 409);
  assert.ok(db.table("duel_matches").some((r) => r.id === v.matchId), "la partida terminada sigue guardada");
});

test("F67 PvE · una jugada tardía pensada para el turno anterior (otra carta, versión vieja) NO se aplica al turno siguiente", async () => {
  const db = seed();
  const v = await freshMatch(db);
  assert.equal(v.stateVersion, 0, "la vista inicial trae su versión");
  const first = move(v, 0);
  const r1 = await playTurn(db.client, U, v.matchId, first.card, first.stat, v.stateVersion);
  assert.ok(r1.ok);
  assert.equal(r1.data!.view.stateVersion, 1);
  // Llega tarde una segunda jugada nacida de la MISMA vista (otra carta): antes podía valer para el turno 2.
  const late = move(v, 1);
  const r2 = await playTurn(db.client, U, v.matchId, late.card, undefined, v.stateVersion);
  assert.equal(r2.status, 409);
  assert.equal((r2 as { code?: string }).code, "STALE_STATE");
  const now = await getMatch(db.client, U, v.matchId);
  assert.equal(now.data!.view.history.length, r1.data!.view.history.length, "ningún turno extra");
  assert.equal(now.data!.view.stateVersion, 1);
});

test("F67 PvE · diez jugadas simultáneas con la versión de la vista: exactamente una en total", async () => {
  const db = seed();
  const v = await freshMatch(db);
  const rs = await Promise.all(Array.from({ length: 10 }, (_, k) => { const m = move(v, k); return playTurn(db.client, U, v.matchId, m.card, m.stat, v.stateVersion); }));
  assert.equal(rs.filter((r) => r.ok).length, 1);
  const now = await getMatch(db.client, U, v.matchId);
  assert.equal(now.data!.view.stateVersion, 1);
});
