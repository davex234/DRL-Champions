/**
 * ICON (2026-10-09) · RECETA Champions → ICON Premium 3:1, con el servicio REAL (`craftPack`) sobre MemSupabase, que
 * reproduce `app_craft_pack` (0059: bloqueo de fila, idempotencia por `economy_ops`, cantidad leída de `craft_recipes`).
 *
 * La receta se cambia en la BD como lo hará el SQL de operador (`scripts/_icon-odds/recipe-sql.ts`): `input_qty` 2 → 3 y
 * `version` + 1 en la fila `pack-champions-icon`, nada más. Fija: descuenta 3 y entrega 1 `icon`; con 2 se rechaza sin
 * tocar nada; una pantalla que aún enseña «2» (expectedQty) recibe 409 sin descontar; concurrencia e idempotencia; las
 * demás recetas no cambian; y el sobre `icon` crafteado se abre con 3 ICON.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCard } from "@/data/catalog";
import { packCardClass } from "@/domain/packs/packClass";
import { MemSupabase } from "./testing/memSupabase";
import { craftPack, getCraftingState } from "./crafting";
import { resetF73Cache } from "./f73Config";
import { openPackForUser } from "./packs";

const A = "aaaaaaaa-0000-4000-8000-00000000ic0a";
const RECIPE = "pack-champions-icon";

function seedRecipes(db: MemSupabase) {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0059_crafting_missions.sql"), "utf8");
  const v = (s: string) => (s === "null" ? null : s.slice(1, -1));
  for (const m of sql.matchAll(/\('([a-z0-9-]+)',\s*'(PACK|CARD)',\s*'([^']+)',\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(\d+),\s*'(ACTIVE|DISABLED)',\s*(\d+)\)/g)) {
    db.table("craft_recipes").push({ id: m[1], kind: m[2], name: m[3], input_pack_id: v(m[4]), output_pack_id: v(m[5]), input_class: v(m[6]), output_class: v(m[7]), input_qty: Number(m[8]), status: m[9], sort_order: Number(m[10]), available_from: null, available_to: null, version: 1 });
  }
}
/** Lo mismo que hará el SQL de operador (y nada más). */
function applyRecipeChange(db: MemSupabase) {
  const r = db.table("craft_recipes").find((x) => x.id === RECIPE)!;
  assert.equal(r.input_qty, 2, "partimos de la receta de producción (2:1)");
  r.input_qty = 3; r.version = Number(r.version) + 1; r.name = "Champions → ICON Premium";
  resetF73Cache();
}
function world(champions: number, recipeChanged = true): MemSupabase {
  resetF73Cache();
  const db = new MemSupabase();
  db.table("profiles").push({ id: A, username: "icon-qa", credits: 0, xp: 0, level: 1, points: 0 });
  seedRecipes(db);
  if (recipeChanged) applyRecipeChange(db);
  if (champions > 0) db.table("user_packs").push({ user_id: A, pack_id: "champions", qty: champions });
  return db;
}
const qty = (db: MemSupabase, packId: string) => Number(db.table("user_packs").find((r) => r.user_id === A && r.pack_id === packId)?.qty ?? 0);
const recipeSnapshot = (db: MemSupabase) => JSON.stringify(db.table("craft_recipes").filter((r) => r.id !== RECIPE));

test("RECETA 3:1 · con 3 Champions: descuenta EXACTAMENTE 3, entrega EXACTAMENTE 1 `icon` y lo audita en economy_ops", async () => {
  const db = world(3);
  const r = await craftPack(db.client, A, RECIPE, "gesto-icon-3-1-0001", 3);
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.data!.inputs, [{ packId: "champions", qty: 3 }]);
  assert.deepEqual(r.data!.outputs, [{ packId: "icon", qty: 1 }]);
  assert.deepEqual([qty(db, "champions"), qty(db, "icon")], [0, 1]);
  assert.equal(db.table("economy_ops").filter((o) => o.kind === "craft_pack").length, 1);
  // La pantalla de crafteo enseña la receta nueva.
  const st = await getCraftingState(db.client, A);
  assert.ok(st.ok);
  assert.equal(st.data!.packRecipes.find((x) => x.id === RECIPE)!.inputQty, 3);
});

test("RECETA 3:1 · con SOLO 2 Champions se rechaza (INSUFFICIENT_PACKS) y no cambia nada", async () => {
  const db = world(2);
  const r = await craftPack(db.client, A, RECIPE, "gesto-icon-2-only-01", 3);
  assert.equal(r.ok, false); assert.equal(r.status, 409); assert.equal(r.code, "INSUFFICIENT_PACKS");
  assert.deepEqual([qty(db, "champions"), qty(db, "icon")], [2, 0]);
  assert.equal(db.table("economy_ops").length, 0);
});

test("RECETA 3:1 · una pantalla que aún dice «2 Champions» (expectedQty 2) recibe 409 RECIPE_CHANGED y NO se descuenta nada", async () => {
  const db = world(9);
  const r = await craftPack(db.client, A, RECIPE, "gesto-icon-stale-001", 2);
  assert.equal(r.ok, false); assert.equal(r.status, 409); assert.equal(r.code, "RECIPE_CHANGED");
  assert.match(r.error ?? "", /ahora son 3 sobres/);
  assert.deepEqual([qty(db, "champions"), qty(db, "icon")], [9, 0]);
  assert.equal(db.table("economy_ops").length, 0);
});

test("RECETA 3:1 · la comprobación usa la receta FRESCA aunque la caché de configuración aún diga 2", async () => {
  const db = world(6, false);
  const before = await getCraftingState(db.client, A); // llena la caché (5 s) con la receta 2:1
  assert.ok(before.ok); assert.equal(before.data!.packRecipes.find((x) => x.id === RECIPE)!.inputQty, 2);
  const row = db.table("craft_recipes").find((x) => x.id === RECIPE)!;
  row.input_qty = 3; row.version = 2; // el operador aplica el SQL; la caché NO se limpia
  const stale = await craftPack(db.client, A, RECIPE, "gesto-icon-cache-001", 2);
  assert.equal(stale.ok, false); assert.equal(!stale.ok && stale.code, "RECIPE_CHANGED");
  assert.equal(qty(db, "champions"), 6, "ni un sobre descontado con la cantidad vieja");
});

test("RECETA 3:1 · mismo gesto repetido = una sola operación; 10 crafteos simultáneos con 9 Champions = exactamente 3, nunca negativo", async () => {
  const db = world(9);
  const [a, b] = await Promise.all([craftPack(db.client, A, RECIPE, "gesto-icon-same-0001", 3), craftPack(db.client, A, RECIPE, "gesto-icon-same-0001", 3)]);
  assert.ok(a.ok && b.ok);
  assert.equal([a, b].filter((x) => x.ok && x.data!.repeated).length, 1, "el segundo devuelve lo guardado");
  assert.deepEqual([qty(db, "champions"), qty(db, "icon")], [6, 1]);
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => craftPack(db.client, A, RECIPE, `gesto-icon-par-${String(i).padStart(5, "0")}`, 3)));
  assert.equal(rs.filter((x) => x.ok).length, 2, "con 6 Champions solo caben 2 más");
  assert.deepEqual([qty(db, "champions"), qty(db, "icon")], [0, 3]);
});

test("RECETA 3:1 · no toca ninguna otra receta: Bronce → Plata sigue 4:1 y las filas ajenas quedan idénticas", async () => {
  const before = world(0, false), after = world(0, true);
  assert.equal(recipeSnapshot(before), recipeSnapshot(after), "solo cambia la fila pack-champions-icon");
  after.table("user_packs").push({ user_id: A, pack_id: "estandar", qty: 4 });
  const r = await craftPack(after.client, A, "pack-estandar-premium", "gesto-icon-other-001", 4);
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.data!.inputs, [{ packId: "estandar", qty: 4 }]);
});

test("RECETA 3:1 · el ICON Premium crafteado es un `icon` como cualquiera: se abre con 3 cartas ICON", async () => {
  const db = world(3);
  db.table("user_game").push({ user_id: A, pity: { version: 1, counters: {} }, packs_opened: 0 });
  const r = await craftPack(db.client, A, RECIPE, "gesto-icon-open-0001", 3);
  assert.ok(r.ok, r.error);
  const o = await openPackForUser(db.client, A, "icon", "gesto-icon-open-pack1");
  assert.ok(o.ok, o.ok ? "" : o.error);
  assert.equal(o.data.opened.length, 3);
  for (const c of o.data.opened) assert.equal(packCardClass(getCard(c.cardId)!), "icon");
  assert.equal(qty(db, "icon"), 0);
});
