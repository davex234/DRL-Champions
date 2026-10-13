/**
 * FASE 57.3 · PACK CLASS DISTRIBUTION POR LA RUTA REAL DEL SERVIDOR (antes: techo de poder del Hotfix 57.2).
 *
 * `openPackForUser` contra un Supabase EN MEMORIA con la RPC `app_apply_pack_open` reproducida (misma forma que
 * `packs.reveal.test.ts`, F38). Se comprueba en las FILAS PERSISTIDAS: toda carta guardada de Bronce, Plata, Oro, Masters,
 * Champions e Icon pertenece a una clase con probabilidad > 0 en su sobre, Icon persiste EXACTAMENTE 1 carta por apertura,
 * y un reintento, un doble clic o una carrera del mismo gesto devuelven lo ya guardado. RLS/Postgres reales: NO EJECUTADO.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getCard } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { mainPackDistribution, packCardClass, MAIN_PACK_LINE } from "@/domain/packs/packClass";
import { MemorySupabase, type Row } from "./testing/memorySupabase";
import { openPackForUser } from "./packs";

const U = "aaaaaaaa-0000-4000-8000-000000000572";

function world(packs: Record<string, number>) {
  const db = new MemorySupabase();
  db.tables = {
    profiles: [{ id: U, credits: 0, xp: 0 }],
    user_cards: [],
    user_packs: Object.entries(packs).map(([pack_id, qty]) => ({ user_id: U, pack_id, qty })),
    user_game: [{ user_id: U, pity: { version: 1, counters: {} }, packs_opened: 0 }],
    card_mints: [],
    economy_ops: [],
    credit_transactions: [],
  };
  db.rpcHandlers.app_apply_pack_open = (a: Row) => {
    const prev = db.rows("economy_ops").find((r) => r.ref === a.p_ref);
    if (prev) return { data: { ...(prev.result as Row), repeated: true }, error: null };
    const pack = db.rows("user_packs").find((r) => r.user_id === a.p_user && r.pack_id === a.p_pack_id);
    if (!pack || (pack.qty as number) < 1) return { data: null, error: { code: "P0001", message: "No tienes ese sobre" } };
    pack.qty = (pack.qty as number) - 1;
    const uids = (a.p_instances as Row[]).map((ins) => {
      const uid = randomUUID();
      db.rows("user_cards").push({ uid, user_id: a.p_user, card_id: ins.cardId, serial: ins.serial ?? null, origin: "pack", locked: false, obtained_at: "2026-09-23T00:00:00Z", minted_version: 2, pack_id: a.p_pack_id });
      return uid;
    });
    const game = db.rows("user_game").find((r) => r.user_id === a.p_user)!;
    game.packs_opened = (game.packs_opened as number) + 1;
    const result = { uids, packId: a.p_pack_id };
    if (a.p_ref) db.rows("economy_ops").push({ ref: a.p_ref, user_id: a.p_user, kind: "open_pack", result });
    return { data: result, error: null };
  };
  return db;
}

const opens = (db: MemorySupabase) => db.rpcCalls.filter((c) => c.name === "app_apply_pack_open").length;

for (const id of MAIN_PACK_LINE) {
  const table = mainPackDistribution(id)!;
  const allowed = (cardId: string) => table[packCardClass(getCard(cardId)!)!] > 0;

  test(`SERVIDOR · ${id}: 60 aperturas reales, toda carta PERSISTIDA es de una clase con probabilidad y el sobre llega completo`, async () => {
    const db = world({ [id]: 60 });
    for (let i = 0; i < 60; i++) {
      const r = await openPackForUser(db.client, U, id, `g-${id}-${i}`);
      assert.ok(r.ok, r.ok ? "" : r.error);
      assert.equal(r.data.opened.length, getPack(id)!.cardCount, "sobre completo");
      for (const c of r.data.opened) assert.ok(allowed(c.cardId), `${id}: ${c.cardId} (${packCardClass(getCard(c.cardId)!)})`);
    }
    for (const row of db.rows("user_cards")) assert.ok(allowed(String(row.card_id)), `persistida ${row.card_id}`);
    assert.equal(db.rows("user_cards").length, 60 * getPack(id)!.cardCount, "ni una carta de más");
    assert.equal(opens(db), 60);
  });

  test(`SERVIDOR · ${id}: reintento, doble clic y carrera del mismo gesto → las MISMAS cartas, sin otro sorteo`, async () => {
    const db = world({ [id]: 3 });
    const first = await openPackForUser(db.client, U, id, "g-same");
    const [a, b] = await Promise.all([openPackForUser(db.client, U, id, "g-same"), openPackForUser(db.client, U, id, "g-same")]);
    db.failing.add("economy_ops"); // la consulta previa no ve la operación → sortea → la RPC responde «repetida»
    const race = await openPackForUser(db.client, U, id, "g-same");
    db.failing.delete("economy_ops");
    assert.ok(first.ok && a.ok && b.ok && race.ok);
    const ids = (r: typeof first) => (r.ok ? r.data.opened.map((c) => [c.uid, c.cardId]) : []);
    for (const r of [a, b, race]) {
      assert.equal(r.ok && r.data.repeated, true);
      assert.deepEqual(ids(r), ids(first));
    }
    assert.equal(db.rows("user_packs")[0].qty, 2, "un solo sobre consumido");
    assert.equal(db.rows("user_cards").length, first.ok ? first.data.opened.length : -1, "sin cartas de sorteos descartados");
  });
}

test("SERVIDOR · Icon: cada apertura persiste EXACTAMENTE 3 filas (Fase 57.4), Future Star / Record Breaker / Moments, y consume 1 sobre", async () => {
  const db = world({ icon: 40 });
  for (let i = 0; i < 40; i++) {
    const before = db.rows("user_cards").length;
    const r = await openPackForUser(db.client, U, "icon", `g-icon-one-${i}`);
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.equal(r.data.opened.length, 3);
    assert.equal(db.rows("user_cards").length - before, 3);
    for (const c of r.data.opened) assert.ok(["future-star", "record-breaker", "moments"].includes(getCard(c.cardId)!.variantId));
  }
  assert.equal(db.rows("user_packs")[0].qty, 0);
});
