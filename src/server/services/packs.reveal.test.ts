/**
 * FASE 38 · APERTURA AUTORITATIVA E IDEMPOTENTE — servicio de sobres contra un Supabase EN MEMORIA con una RPC que
 * reproduce `app_apply_pack_open` (0019): clave en `economy_ops`, bloqueo/consumo del sobre, instancias, contador.
 * Motor de sobres REAL (catálogo del código). RLS/Postgres reales: NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCard } from "@/data/catalog";
import { MemorySupabase, type Row } from "./testing/memorySupabase";
import { openPackForUser, packOpRef } from "./packs";

const U = "aaaaaaaa-0000-4000-8000-000000000038";
const V = "bbbbbbbb-0000-4000-8000-000000000038";
const OWNED = "aspas__base"; // carta real del catálogo diseñado (antes aspas__gold)

function world(qty = 1) {
  const db = new MemorySupabase();
  db.tables = {
    profiles: [{ id: U, credits: 1234, xp: 0 }, { id: V, credits: 50, xp: 0 }],
    user_cards: getCard(OWNED) ? [{ uid: "owned-1", user_id: U, card_id: OWNED, serial: null, origin: "starter", locked: false, obtained_at: "2026-09-01T00:00:00Z", minted_version: 1 }] : [],
    user_packs: [{ user_id: U, pack_id: "estandar", qty }],
    user_game: [{ user_id: U, pity: { version: 1, counters: {} }, packs_opened: 7 }, { user_id: V, pity: { version: 1, counters: {} }, packs_opened: 0 }],
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
      db.rows("user_cards").push({ uid, user_id: a.p_user, card_id: ins.cardId, serial: ins.serial ?? null, origin: ins.origin ?? "pack", locked: false, obtained_at: "2026-09-15T20:00:00Z", minted_version: 2 });
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
const cardsOf = (db: MemorySupabase, user = U) => db.rows("user_cards").filter((r) => r.user_id === user);
const opened = (db: MemorySupabase) => db.rows("user_game").find((r) => r.user_id === U)!.packs_opened;

test("APERTURA · cada carta devuelta ES la fila persistida: uid ↔ carta ↔ serial ↔ versión acuñada", async () => {
  const db = world();
  const r = await openPackForUser(db.client, U, "estandar", "g-fresh");
  assert.ok(r.ok);
  assert.equal(r.data.repeated, false);
  assert.equal(r.data.opened.length, 5);
  for (const c of r.data.opened) {
    const row = cardsOf(db).find((x) => x.uid === c.uid)!;
    assert.ok(row, "uid real, no generado en el cliente");
    assert.equal(c.cardId, row.card_id);
    assert.equal(c.serial, row.serial ?? null);
    assert.equal(c.mintedVersion, row.minted_version, "la versión sale de la BD");
  }
});

test("APERTURA · +1 sobre abierto, −1 sobre, +5 cartas; créditos intactos y ni un movimiento de créditos", async () => {
  const db = world(2);
  const r = await openPackForUser(db.client, U, "estandar", "g-eco");
  assert.ok(r.ok);
  assert.equal(opened(db), 8);
  assert.equal(db.rows("user_packs")[0].qty, 1);
  assert.equal(cardsOf(db).length, 6);
  assert.equal(db.rows("profiles").find((p) => p.id === U)!.credits, 1234);
  assert.equal(db.rows("credit_transactions").length, 0);
});

test("REINTENTO · misma clave → MISMAS cartas (mismos uids, cartas y seriales), sin otro sorteo ni otra RPC", async () => {
  const db = world(3);
  const first = await openPackForUser(db.client, U, "estandar", "g-retry");
  const second = await openPackForUser(db.client, U, "estandar", "g-retry");
  assert.ok(first.ok && second.ok);
  assert.equal(second.data.repeated, true);
  assert.deepEqual(second.data.opened.map((c) => [c.uid, c.cardId, c.serial]), first.data.opened.map((c) => [c.uid, c.cardId, c.serial]));
  assert.equal(opens(db), 1, "la RPC solo se llama una vez");
  assert.equal(opened(db), 8, "+0 aperturas");
  assert.equal(cardsOf(db).length, 6, "+0 cartas");
  assert.equal(db.rows("user_packs")[0].qty, 2, "+0 sobres consumidos");
});

test("REINTENTO · aunque ese fuera el ÚLTIMO sobre: devuelve lo guardado, no 409", async () => {
  const db = world(1);
  const first = await openPackForUser(db.client, U, "estandar", "g-last");
  assert.ok(first.ok);
  assert.equal(db.rows("user_packs")[0].qty, 0);
  const again = await openPackForUser(db.client, U, "estandar", "g-last");
  assert.ok(again.ok, again.ok ? "" : again.error);
  assert.equal(again.data.repeated, true);
  assert.deepEqual(again.data.opened.map((c) => c.uid), first.data.opened.map((c) => c.uid));
});

test("REINTENTO · la respuesta repetida no vuelve a sumar XP", async () => {
  const db = world(2);
  await openPackForUser(db.client, U, "estandar", "g-xp");
  const again = await openPackForUser(db.client, U, "estandar", "g-xp");
  assert.ok(again.ok);
  assert.equal(again.data.xpGained, 0);
});

test("CLAVE NUEVA sin sobres → 409, sin tocar nada", async () => {
  const db = world(1);
  await openPackForUser(db.client, U, "estandar", "g-a");
  const r = await openPackForUser(db.client, U, "estandar", "g-b");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 409);
  assert.equal(opened(db), 8);
});

test("CARRERA · la RPC responde «repetida» (otra petición del mismo gesto): se leen las cartas persistidas, nunca las de este sorteo", async () => {
  const db = world(3);
  const first = await openPackForUser(db.client, U, "estandar", "g-race");
  assert.ok(first.ok);
  db.failing.add("economy_ops"); // la consulta previa no ve la operación → sortea → la RPC dice «repeated»
  const second = await openPackForUser(db.client, U, "estandar", "g-race");
  db.failing.delete("economy_ops");
  assert.ok(second.ok);
  assert.equal(second.data.repeated, true);
  assert.deepEqual(second.data.opened.map((c) => [c.uid, c.cardId, c.serial]), first.data.opened.map((c) => [c.uid, c.cardId, c.serial]));
  assert.equal(cardsOf(db).length, 6);
});

test("REPETIDA · «nueva» se deriva de las demás copias del usuario (la primera aparición, si no había otras)", async () => {
  const db = world(2);
  const first = await openPackForUser(db.client, U, "estandar", "g-new");
  assert.ok(first.ok);
  const again = await openPackForUser(db.client, U, "estandar", "g-new");
  assert.ok(again.ok);
  const seen = new Set<string>();
  for (const c of again.data.opened) {
    const others: number = cardsOf(db).filter((r) => r.card_id === c.cardId && !again.data.opened.some((o) => o.uid === r.uid)).length;
    assert.equal(c.isNew, others === 0 && !seen.has(c.cardId), c.cardId);
    seen.add(c.cardId);
  }
});

test("AISLAMIENTO · el mismo texto de gesto de otro usuario es OTRA operación: nunca ve las cartas ajenas", async () => {
  const db = world(1);
  const mine = await openPackForUser(db.client, U, "estandar", "g-shared");
  assert.ok(mine.ok);
  assert.notEqual(packOpRef(U, "open", "g-shared"), packOpRef(V, "open", "g-shared"));
  const theirs = await openPackForUser(db.client, V, "estandar", "g-shared");
  assert.equal(theirs.ok, false, "V no tiene sobres: 409, no las cartas de U");
});

test("AISLAMIENTO · una operación guardada de OTRO sobre no se reutiliza ni filtra cartas", async () => {
  const db = world(1);
  await openPackForUser(db.client, U, "estandar", "g-other");
  const r = await openPackForUser(db.client, U, "premium", "g-other");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 409);
});

test("REPETIDA · si una carta ya no existe (p. ej. desguazada), no se inventa: se devuelven las que siguen", async () => {
  const db = world(1);
  const first = await openPackForUser(db.client, U, "estandar", "g-gone");
  assert.ok(first.ok);
  const gone = first.data.opened[0].uid;
  db.tables.user_cards = cardsOf(db).filter((r) => r.uid !== gone);
  const again = await openPackForUser(db.client, U, "estandar", "g-gone");
  assert.ok(again.ok);
  assert.equal(again.data.opened.length, 4);
  assert.ok(!again.data.opened.some((c) => c.uid === gone));
});

test("SIN CLAVE · se abre una vez (el servidor fabrica el gesto) y no hay consulta de operación previa", async () => {
  const db = world(1);
  const r = await openPackForUser(db.client, U, "estandar");
  assert.ok(r.ok);
  assert.equal(r.data.repeated, false);
  assert.ok(!db.log.includes("select:economy_ops"));
});

test("CLIENTE NO DECIDE · la apertura no acepta cartas, rareza, serial ni versión: solo usuario, sobre y gesto", () => {
  const src = readFileSync(join(process.cwd(), "src/server/services/packs.ts"), "utf8");
  const sig = src.slice(src.indexOf("export async function openPackForUser("), src.indexOf("): Promise<ServiceResult<OpenPackData>> {", src.indexOf("export async function openPackForUser(")));
  assert.match(sig, /sb: SupabaseClient, userId: string, packId: string, gesture\?: string,\s*resolve: PackResolver = getPack/);
  assert.ok(!/cardId|serial|rarity|bucket|minted|seed|weights|price/.test(sig));
});
