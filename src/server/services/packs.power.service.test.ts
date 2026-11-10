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

for (const [id, n] of [["icon-single", 1], ["icon", 3]] as const) {
  test(`SERVIDOR · ${id} (2026-10-09): cada apertura persiste EXACTAMENTE ${n} fila(s), todas Record Breaker o Moments, y consume 1 sobre`, async () => {
    const db = world({ [id]: 40 });
    for (let i = 0; i < 40; i++) {
      const before = db.rows("user_cards").length;
      const r = await openPackForUser(db.client, U, id, `g-${id}-${i}`);
      assert.ok(r.ok, r.ok ? "" : r.error);
      assert.equal(r.data.opened.length, n);
      assert.equal(db.rows("user_cards").length - before, n);
      for (const c of r.data.opened) {
        assert.ok(["record-breaker", "moments"].includes(getCard(c.cardId)!.variantId));
        assert.ok(db.rows("user_cards").some((row) => row.uid === c.uid && row.card_id === c.cardId), "lo devuelto es lo persistido");
      }
    }
    assert.equal(db.rows("user_packs")[0].qty, 0);
  });
}

test("SERVIDOR · COMPATIBILIDAD: un sobre `icon` adquirido ANTES (fila user_packs existente) se abre con sus 3 cartas ICON", async () => {
  // El inventario de producción guarda el id; el id histórico se conserva, así que un sobre comprado a 60.000 (o recibido
  // por `s-collect` o por la receta Champions → Icon) sigue siendo un ICON Premium de 3 cartas al abrirlo.
  const db = world({ icon: 2 });
  const r = await openPackForUser(db.client, U, "icon", "legacy-icon-1");
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(r.data.opened.length, 3);
  assert.equal(db.rows("user_packs")[0].qty, 1, "consume uno, conserva el otro");
  const again = await openPackForUser(db.client, U, "icon", "legacy-icon-1");
  assert.ok(again.ok && again.data.repeated, "reintento idempotente");
  assert.deepEqual(again.ok ? again.data.opened.map((c) => c.uid) : [], r.data.opened.map((c) => c.uid));
  assert.equal(db.rows("user_cards").length, 3, "sin cartas de más");
});

test("SERVIDOR · Icon por sobre (2026-10-09): en Bronce…Champions, como mucho UNA Icon por apertura; lo devuelto = lo persistido en el inventario", async () => {
  for (const id of MAIN_PACK_LINE.filter((x) => x !== "icon" && x !== "icon-single")) {
    const db = world({ [id]: 120 });
    let withIcon = 0;
    for (let i = 0; i < 120; i++) {
      const r = await openPackForUser(db.client, U, id, `g-icon-chance-${id}-${i}`);
      assert.ok(r.ok, r.ok ? "" : r.error);
      const icons = r.data.opened.filter((c) => packCardClass(getCard(c.cardId)!) === "icon");
      assert.ok(icons.length <= 1, `${id}: ${icons.length} Icon`);
      if (icons.length) withIcon++;
      // Cada carta devuelta es una fila PERSISTIDA del usuario con el mismo uid y la misma carta.
      for (const c of r.data.opened) assert.ok(db.rows("user_cards").some((row) => row.uid === c.uid && row.card_id === c.cardId && row.user_id === U), `${id}: ${c.uid}`);
    }
    assert.equal(db.rows("user_cards").length, 120 * getPack(id)!.cardCount, `${id}: ni una carta de más`);
    assert.equal(db.rows("user_packs")[0].qty, 0, `${id}: un sobre por apertura`);
    if (id === "champions") assert.ok(withIcon > 0, "hubo alguna Icon en 120 Champions");
  }
});
