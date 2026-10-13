/**
 * F73 · 0060 — CARRERA DEL DESGUACE SOBRE COPIAS DISTINTAS de la misma carta (auditoría F73 final, 2026-09-30).
 *
 * Antes: la regla «te queda al menos una copia» vivía en Node (`previewSalvage`), fuera de la transacción. Dos desguaces
 * simultáneos de X e Y, o un desguace de X a la vez que un intercambio de F73 consume Y, podían dejarte con 0 copias.
 * 0060 bloquea todas las copias de las cartas implicadas y comprueba la regla en la RPC; MemSupabase refleja la misma
 * semántica. Aquí se prueba el INVARIANTE (nunca 0 copias) y que la RPC por sí sola rechaza la última copia.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CARDS } from "@/data/catalog";
import { packCardClass } from "@/domain/packs/packClass";
import { MemSupabase } from "./testing/memSupabase";
import { salvageCards } from "./economy";
import { craftCard, getCraftingState } from "./crafting";
import { resetF73Cache } from "./f73Config";

const A = "aaaaaaaa-0000-4000-8000-0000000060aa";

function fresh(): MemSupabase {
  resetF73Cache();
  const db = new MemSupabase();
  db.table("profiles").push({ id: A, username: "salvage60", credits: 1_000, xp: 0, level: 1, points: 0 });
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0059_crafting_missions.sql"), "utf8");
  const v = (s: string) => (s === "null" ? null : s.slice(1, -1));
  for (const m of sql.matchAll(/\('([a-z0-9-]+)',\s*'(PACK|CARD)',\s*'([^']+)',\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(\d+),\s*'(ACTIVE|DISABLED)',\s*(\d+)\)/g)) {
    db.table("craft_recipes").push({ id: m[1], kind: m[2], name: m[3], input_pack_id: v(m[4]), output_pack_id: v(m[5]), input_class: v(m[6]), output_class: v(m[7]), input_qty: Number(m[8]), status: m[9], sort_order: Number(m[10]), available_from: null, available_to: null, version: 1 });
  }
  return db;
}
function give(db: MemSupabase, cardId: string, n: number): string[] {
  return Array.from({ length: n }, () => { const uid = randomUUID(); db.table("user_cards").push({ uid, user_id: A, card_id: cardId, serial: null, origin: "pack", locked: false, minted_version: null, obtained_at: new Date(0).toISOString() }); return uid; });
}
/**
 * Barrera: las RPC indicadas esperan hasta que lleguen `n` llamadas. Así las comprobaciones previas de Node de TODAS las
 * peticiones ocurren antes que cualquier escritura: el entrelazado real de dos peticiones simultáneas en producción.
 * Sin esto MemSupabase ejecutaba una petición entera antes de la otra y la carrera no se reproducía (control verificado).
 */
function barrier(db: MemSupabase, fns: string[], n: number) {
  const client = db.client as unknown as { rpc: (fn: string, args: unknown) => Promise<unknown> };
  const orig = client.rpc.bind(client);
  const seen: string[] = [];
  let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
  const timer = setTimeout(() => release(), 1500); // nunca bloquea: si alguien no llega a su RPC, se sigue igual
  client.rpc = async (fn: string, args: unknown) => {
    if (fns.includes(fn)) { seen.push(fn); if (seen.length >= n) { clearTimeout(timer); release(); } await gate; }
    return orig(fn, args);
  };
  return seen;
}
const copies = (db: MemSupabase, cardId: string) => db.table("user_cards").filter((r) => r.user_id === A && r.card_id === cardId).length;
const basics = CARDS.filter((c) => packCardClass(c) === "base");

test("0060 · la RPC rechaza desguazar la ÚLTIMA copia aunque Node no la haya filtrado (LAST_COPY)", async () => {
  const db = fresh();
  const [x, y] = give(db, basics[0].id, 2);
  db.tables.user_cards = db.table("user_cards").filter((r) => r.uid !== y); // el intercambio ya consumió Y
  const r = await db.client.rpc("app_salvage_cards", { p_user: A, p_uids: [x], p_total: 5, p_ref: "salvage-60-rpc" });
  assert.ok(r.error && /LAST_COPY/.test(r.error.message), "la RPC debe negarse");
  assert.equal(copies(db, basics[0].id), 1, "X sigue existiendo");
});

/** Orden real de `previewSalvage`: se conserva la copia de uid MENOR y el resto es sobrante desguazable. */
const byUid = (uids: string[]) => [...uids].sort((a, b) => a.localeCompare(b));

test("0060 · desguace + desguace SIMULTÁNEOS: la copia que se conserva es determinista (uid menor) y nunca se toca", async () => {
  const db = fresh();
  const [kept, surplus] = byUid(give(db, basics[1].id, 2));
  const [r1, r2] = await Promise.all([salvageCards(db.client, A, [surplus], "salv-60-a"), salvageCards(db.client, A, [kept], "salv-60-b")]);
  assert.ok(r1.ok, r1.ok ? "" : r1.error); assert.equal(r2.ok, false, "la copia conservada no es desguazable");
  assert.deepEqual(db.table("user_cards").filter((r) => r.card_id === basics[1].id).map((r) => r.uid), [kept]);
});

test("0060 · CARRERA REAL: el desguace se lleva el sobrante Y mientras un intercambio consume la copia conservada X → nunca 0 copias", async () => {
  const db = fresh();
  const target = basics[2].id;
  const [kept, surplus] = byUid(give(db, target, 2));
  const others = basics.slice(3, 9).map((c) => give(db, c.id, 2)[0]);
  const st = await getCraftingState(db.client, A);
  assert.ok(st.ok);
  const seen = barrier(db, ["app_salvage_cards_guarded", "app_craft_card_guarded"], 2); // F79.1 · desde 0061 las rutas usan las RPC guardadas
  const [sv, cr] = await Promise.all([
    salvageCards(db.client, A, [surplus], "salv-60-race"),
    craftCard(db.client, A, "card-base-plata", [kept, ...others], "craft-60-race-000"),
  ]);
  assert.equal(seen.length, 2, "las DOS peticiones llegaron a su RPC después de validar en Node (entrelazado real)");
  assert.ok(copies(db, target) >= 1, `nunca 0 copias (desguace ${sv.ok ? "ok" : sv.status} · intercambio ${cr.ok ? "ok" : cr.status})`);
  assert.equal([sv.ok, cr.ok].filter(Boolean).length, 1, "gana una y la otra se rechaza");
  assert.ok(sv.ok || sv.status === 409, "el desguace perdedor responde 409, nunca 500");
});

test("0060 · un duplicado real se sigue desguazando igual (mismo pago, idempotente)", async () => {
  const db = fresh();
  const [, surplus] = byUid(give(db, basics[10].id, 2));
  const r = await salvageCards(db.client, A, [surplus], "salv-60-ok");
  if (!r.ok) throw new Error(r.error);
  assert.equal(r.data.salvaged, 1);
  const again = await salvageCards(db.client, A, [surplus], "salv-60-ok");
  if (!again.ok) throw new Error(again.error);
  assert.equal(again.data.repeated, true);
  assert.equal(copies(db, basics[10].id), 1);
});

test("0060 · el SQL bloquea TODAS las copias de las cartas implicadas y comprueba la última copia dentro de la RPC", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0060_salvage_last_copy_atomic.sql"), "utf8");
  assert.match(sql, /card_id = any\(v_cards\) for update/);
  assert.match(sql, /LAST_COPY/);
  assert.match(sql, /grant execute on function public\.app_salvage_cards\(uuid, uuid\[\], bigint, text\) to service_role/);
  assert.doesNotMatch(sql, /grant execute[^;]*to (anon|authenticated)/);
});
