/**
 * F80 · PACK PRICE REBALANCE — precios nuevos de la línea principal, congelados, y el cobro que los aplica.
 *
 *   Bronce 2.500 · Plata 6.000 · Oro 12.000 · Masters 20.000 · Champions 35.000 · Icon 60.000
 *
 * Solo cambian esos seis precios (fuente única: `data/packs`, que el SERVIDOR pasa a `app_buy_pack`). Contenido,
 * probabilidades, cartas por sobre, sobres especiales y créditos iniciales: intactos (huellas de antes de F80 abajo).
 * Los cobros se prueban con el servicio REAL (`buyPack`, `storeCheckout`) sobre MemSupabase, que reproduce la RPC
 * `app_buy_pack` (libro mayor con suelo + idempotencia por `ref` en `economy_ops`).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKS, getPack } from "@/data/packs";
import { PACK_STATS } from "@/data/packStats";
import { STORE_CATALOG } from "@/data/storeCatalog";
import { MAIN_PACK_LINE, MAIN_PACK_PLAN } from "@/domain/packs/packClass";
import { packOddsFor } from "@/domain/packs/odds";
import { STARTER_GRANT } from "@/domain/onboarding/starterMath";
import { findStoreProduct, optionFor } from "@/domain/store/resolve";
import { formatCredits } from "@/lib/format";
import { MemSupabase } from "@/server/services/testing/memSupabase";
import { buyPack } from "@/server/services/packs";
import { storeCheckout } from "@/server/services/store";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { PAYMENTS_ENABLED } from "@/config/monetization";

// ICON (2026-10-09): + el Sobre ICON de 1 carta (`icon-single`, 30.000). Sin precio F57.4: se prueba con el del Icon de entonces.
// ICON (2026-10-09, decisión final): ICON Premium (`icon`) a 80.000.
const F80 = { estandar: 2500, premium: 6000, oro: 12000, masters: 20000, champions: 35000, "icon-single": 30000, icon: 80000 } as const;
const F574 = { estandar: 1000, premium: 2500, oro: 4000, masters: 5000, champions: 8000, "icon-single": 12500, icon: 12500 } as const;
type Id = keyof typeof F80;
const IDS = Object.keys(F80) as Id[];
const U = "f8000000-0000-4000-8000-000000000080";

const credits = (db: MemSupabase) => Number(db.table("profiles").find((x) => x.id === U)!.credits);
const packsOf = (db: MemSupabase, id: string) => Number(db.table("user_packs").find((r) => r.user_id === U && r.pack_id === id)?.qty ?? 0);
const debits = (db: MemSupabase, id: string) => db.table("credit_transactions").filter((t) => t.user_id === U && t.reason === `buy_pack:${id}`);
// `seedUser` reproduce el alta (0011): 3 Iniciales + 1 Bronce. Los sobres se cuentan como DIFERENCIA sobre ese punto.
const fresh = (balance: number) => { const db = new MemSupabase(); db.seedUser(U, balance); return db; };
const STARTER_PACKS: Record<string, number> = { estandar: 1 };
const gained = (db: MemSupabase, id: string) => packsOf(db, id) - (STARTER_PACKS[id] ?? 0);

test("F80 · los seis precios oficiales, congelados (un cambio accidental rompe aquí)", () => {
  assert.deepEqual(MAIN_PACK_LINE, ["estandar", "premium", "oro", "masters", "champions", "icon-single", "icon"]);
  assert.deepEqual(Object.fromEntries(MAIN_PACK_LINE.map((id) => [id, getPack(id)!.price])), F80);
  assert.equal(getPack("estandar")!.price, 2500);
  assert.equal(getPack("premium")!.price, 6000);
  assert.equal(getPack("oro")!.price, 12000);
  assert.equal(getPack("masters")!.price, 20000);
  assert.equal(getPack("champions")!.price, 35000);
  assert.equal(getPack("icon")!.price, 80000);
  assert.equal(getPack("icon-single")!.price, 30000);
  // La estadística medida (lo que lee el admin y los suelos de crafteo) lleva el MISMO precio: sin segunda fuente.
  for (const id of IDS) assert.equal(PACK_STATS[id].price, F80[id], `packStats ${id}`);
});

test("F80 + PACK OPENING 3.1 · precios de los especiales (3.1: China y su familia a 9.500, EWC a 8.500), cartas por sobre y créditos iniciales", () => {
  const others = Object.fromEntries(PACKS.filter((p) => !(p.id in F80)).map((p) => [p.id, p.price]));
  assert.deepEqual(others, {
    inicial: 0, ewc: 8500, emea: 3500, americas: 3500, pacific: 3500, china: 9500, "team-heretics": 3500, "team-fnatic": 3500,
    "team-navi": 3500, "team-g2": 3500, prime: 10000, "team-loud": 3500, "team-blg": 9500, "team-te": 9500, "team-jdg": 9500,
    "team-liquid": 3500, "team-tyl": 9500, "team-karmine": 3500, "team-m8": 3500, "team-fut": 3500, "team-100t": 3500,
    "team-prx": 3500, "team-ns": 3500, "team-ge": 3500, "team-xlg": 9500, "team-lev": 3500,
  });
  // DOS SOBRES ICON (2026-10-09): Sobre ICON 1 carta (nuevo) · ICON Premium 3 cartas (el `icon` de siempre).
  assert.deepEqual(MAIN_PACK_LINE.map((id) => getPack(id)!.cardCount), [5, 6, 5, 5, 5, 1, 3]);
  assert.equal(STARTER_GRANT.credits, 6000);
  assert.deepEqual(STARTER_GRANT.packs, [{ packId: "inicial", qty: 3 }, { packId: "estandar", qty: 1 }]);
  assert.ok(/credits\s+bigint not null default 6000/.test(readFileSync(join(process.cwd(), "supabase/migrations/0001_init.sql"), "utf8")));
  assert.match(readFileSync(join(process.cwd(), "src/store/useGameStore.ts"), "utf8"), /const STARTER_CREDITS = 6000;/);
  assert.equal(PAYMENTS_ENABLED, false);
  assert.equal(GLOBAL_MARKET_ENABLED, false);
});

test("F80 · con los 6.000 iniciales alcanzan Bronce y Plata; Oro, Masters, Champions e Icon no", () => {
  const can = Object.fromEntries(IDS.map((id) => [id, STARTER_GRANT.credits >= getPack(id)!.price]));
  assert.deepEqual(can, { estandar: true, premium: true, oro: false, masters: false, champions: false, "icon-single": false, icon: false });
});

test("F80 + PACK OPENING 3.0/3.1 · huellas: plan de la línea y su estadística INTACTOS en 3.1; sobres, odds y especiales = 3.1", () => {
  const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v);
  const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(stable(v))).digest("hex");
  const omit = (o: object, k: string) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));
  // Medidas con scripts/_f80-pack-snapshot.ts ANTES de tocar ningún precio (docs/product/qa/f80-pack-prices/).
  // Pack Opening 3.1 · cambian las descripciones de China y EWC (antes c94e9a0a…): precio aparte, nada más en los sobres.
  // Icon por sobre (2026-10-09): DOS SOBRES ICON: nuevo `icon-single`; `icon` cambia nombre, descripción, etiqueta y precio de compra (80.000), mantiene sus 3 cartas (antes ec65db3f…).
  assert.equal(sha(PACKS.map((p) => omit(p, "price"))), "722639f1d062f9f0b0fcef70c82a641ea130cf253144a3fda1d51d7c4495b940", "definición de los sobres sin precio");
  // PACK OPENING 3.0 (2026-10-07) · la tabla F57.3 (huella f755dbdf…) se sustituyó por el plan por ranuras; las odds de
  // la UI (antes 093af671…) y la estadística medida de la línea (antes 4c122a34…) se re-midieron con el plan nuevo.
  // ICON POR SOBRE (2026-10-09) · plan (antes 1a67322e…), odds de la UI (antes dcbbca45…: ahora con la línea Icon) y
  // estadística medida de la línea (antes e899c1d2… / a0baa697…) re-medidas. Los especiales, INTACTOS (e64eea3e…).
  assert.equal(sha(MAIN_PACK_PLAN), "3b1ce8a99b446fd7d475c1bae9cd0da4826be3b55100a9db7f84fba69f555703", "plan por ranuras + Icon por sobre + dos sobres ICON");
  assert.equal(sha(Object.fromEntries(PACKS.map((p) => [p.id, packOddsFor(p, PACK_STATS[p.id] ?? null)]))), "ad0fa0ff0170fcc75b12b01742cc4217634d73c95bac1ee3edb064ff583e309c", "odds que enseña la UI (con Icon por sobre)");
  // La estadística medida solo cambia en lo que es función del precio (precio y coste por rareza = precio / tasa medida).
  const measured = Object.fromEntries(Object.entries(PACK_STATS).map(([id, s]) => [id, omit(omit(s, "price"), "costPerRarity")]));
  assert.equal(sha(measured), "d7bb2cb8dc5cb34e5d0648acf9307fe2cba56c0f271720577cda19c0c85cb6b2", "reparto, valor y desguace medidos (20.000 aperturas, semilla 90210)");
  // La línea principal NO cambió en 3.1; sí con la Icon por sobre (2026-10-09, antes e899c1d2…).
  const main = Object.fromEntries(MAIN_PACK_LINE.map((id) => [id, omit(omit(PACK_STATS[id], "price"), "costPerRarity")]));
  assert.equal(sha(main), "3009a7b778c84927349bbe39cf8906076d0583fae7498d776fc5f0e910ec7c12", "línea principal con Icon por sobre y dos sobres ICON");
  // Pack Opening 3.1 · los especiales sí cambian (antes 2ed3c392…), a propósito.
  const nonMain = Object.fromEntries(Object.entries(PACK_STATS).filter(([id]) => !(id in MAIN_PACK_PLAN)).map(([id, s]) => [id, omit(omit(s, "price"), "costPerRarity")]));
  assert.equal(sha(nonMain), "e64eea3e8d3443f7951e7c02b76c330f6f00d5b696d204a5a74a4f0fef05c9c5", "los 25 sobres fuera de la línea, con Pack Opening 3.1");
  for (const id of IDS) {
    const s = PACK_STATS[id];
    for (const [k, c] of Object.entries(s.costPerRarity) as [keyof typeof s.drawn, number][]) {
      // `drawn` se imprime redondeado a 4 decimales; el generador usa el recuento exacto → tolerancia 1 % + el error de ese
      // redondeo (±0,00005 / tasa), que domina en tasas diminutas (Pack Opening 3.0: legendaria de Bronce ≈ 0,0009).
      assert.ok(Math.abs(c / (F80[id] / (s.cardCount * s.drawn[k])) - 1) < 0.01 + 0.00005 / s.drawn[k], `${id}.${k}: ${c}`);
    }
  }
});

for (const id of IDS) {
  const price = F80[id];
  test(`F80 · ${id}: saldo ${price - 1} → rechazo sin cobrar ni conceder; ${price} → compra exacta a 0 (una vez)`, async () => {
    const poor = fresh(price - 1);
    const r1 = await buyPack(poor.client, U, id, `edge-${id}`, undefined, { expectedPrice: price });
    assert.equal(r1.ok, false); assert.equal(!r1.ok && r1.status, 409); assert.equal(!r1.ok && r1.error, "Créditos insuficientes");
    assert.equal(credits(poor), price - 1); assert.equal(gained(poor, id), 0); assert.equal(debits(poor, id).length, 0);

    const exact = fresh(price);
    const r2 = await buyPack(exact.client, U, id, `edge-${id}`, undefined, { expectedPrice: price });
    assert.ok(r2.ok, r2.ok ? "" : r2.error);
    assert.equal(credits(exact), 0, "cobra exactamente el precio");
    assert.equal(gained(exact, id), 1, "concede exactamente un sobre");
    assert.equal(debits(exact, id).length, 1); assert.equal(Number(debits(exact, id)[0].delta), -price);
  });

  test(`F80 · ${id}: reintento con el mismo gesto no cobra ni concede dos veces; el precio ANTIGUO no compra`, async () => {
    const db = fresh(200_000);
    const a = await buyPack(db.client, U, id, `retry-${id}`, undefined, { expectedPrice: price });
    const b = await buyPack(db.client, U, id, `retry-${id}`, undefined, { expectedPrice: price });
    assert.ok(a.ok && b.ok);
    assert.equal(credits(db), 200_000 - price); assert.equal(gained(db, id), 1); assert.equal(debits(db, id).length, 1);
    // Un cliente que «sabe» el precio de F57.4 y solo tiene ese saldo: el servidor exige el nuevo.
    const old = fresh(F574[id]);
    const c = await buyPack(old.client, U, id, `old-${id}`, undefined, { expectedPrice: price });
    assert.equal(c.ok, false); assert.equal(credits(old), F574[id]); assert.equal(gained(old, id), 0);
  });

  test(`F80 · ${id}: la tienda (POST /api/game/store) muestra y cobra el MISMO precio que el servidor`, async () => {
    const product = findStoreProduct(`pack:${id}`, Date.now(), STORE_CATALOG)!;
    assert.ok(product, `pack:${id} en la tienda`);
    assert.equal(optionFor(product, "GAME_CURRENCY")?.price, price, "precio mostrado = precio cobrado");
    assert.equal(formatCredits(price), price.toLocaleString("de-DE"), "formato 2.500 / 60.000 (enteros, punto de miles)");
    const db = fresh(price);
    const r = await storeCheckout(db.client, U, { productId: `pack:${id}`, method: "GAME_CURRENCY", ref: `store-${id}`, expectedPrice: price }, { buyPack, now: () => Date.now(), catalog: STORE_CATALOG });
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.equal(credits(db), 0); assert.equal(gained(db, id), 1);
  });
}

test("F80 · dos pestañas, saldo para UNA sola compra de Icon: una entra, la otra se rechaza; nunca saldo negativo", async () => {
  const db = fresh(80_000);
  const seen = { expectedPrice: 80_000 };
  const [a, b] = await Promise.all([buyPack(db.client, U, "icon", "tab-a", undefined, seen), buyPack(db.client, U, "icon", "tab-b", undefined, seen)]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.equal(credits(db), 0); assert.equal(gained(db, "icon"), 1); assert.equal(debits(db, "icon").length, 1);
});

test("F80 · el cliente no decide el precio: las rutas solo aceptan el precio VISTO (que bloquea, nunca fija el cobro)", () => {
  const packsRoute = readFileSync(join(process.cwd(), "src/app/api/game/packs/route.ts"), "utf8");
  const storeRoute = readFileSync(join(process.cwd(), "src/app/api/game/store/route.ts"), "utf8");
  // ICON (2026-10-09) · `expectedPrice` = lo que el jugador vio; el cobro sigue siendo `pack.price` (abajo).
  assert.match(packsRoute, /const ALLOWED = \["action", "packId", "ref", "expectedPrice"\];/);
  assert.match(packsRoute, /Object\.keys\(body\)\.some\(\(k\) => !ALLOWED\.includes\(k\)\)/);
  assert.match(storeRoute, /const ALLOWED = \["action", "productId", "method", "ref", "expectedPrice"\];/);
  // El servicio pasa a la RPC el precio del CATÁLOGO DEL SERVIDOR, nunca un argumento del cliente.
  const svc = readFileSync(join(process.cwd(), "src/server/services/packs.ts"), "utf8");
  assert.match(svc, /p_price: pack\.price,/);
});

/* ═══════════════ ICON (2026-10-09) · EL PRECIO QUE EL JUGADOR VIO: nunca un cobro distinto ═══════════════ */

test("PRECIO VISTO · ICON Premium: sin precio visto (pestaña anterior al cambio) → 409 sin cobrar ni conceder", async () => {
  const db = fresh(200_000);
  const r = await buyPack(db.client, U, "icon", "no-seen");
  assert.equal(r.ok, false); assert.equal(!r.ok && r.status, 409);
  assert.equal(credits(db), 200_000); assert.equal(gained(db, "icon"), 0); assert.equal(debits(db, "icon").length, 0);
});

test("PRECIO VISTO · ICON Premium visto a 60.000 (precio antiguo) → 409 «el precio ha cambiado», sin cobrar 80.000", async () => {
  const db = fresh(200_000);
  const r = await buyPack(db.client, U, "icon", "seen-old", undefined, { expectedPrice: 60_000 });
  assert.equal(r.ok, false); assert.equal(!r.ok && r.status, 409); assert.match(!r.ok ? r.error : "", /ahora cuesta 80\.000/);
  assert.equal(credits(db), 200_000); assert.equal(gained(db, "icon"), 0);
  // Tampoco por la tienda, ni con comprar-y-abrir.
  const s = await storeCheckout(db.client, U, { productId: "pack:icon", method: "GAME_CURRENCY", ref: "seen-old-store", expectedPrice: 60_000 }, { buyPack, now: () => Date.now(), catalog: STORE_CATALOG });
  assert.equal(s.ok, false); assert.equal(credits(db), 200_000);
});

test("PRECIO VISTO · un precio visto MÁS BAJO o más alto nunca cambia el importe: o cobra el del servidor o no cobra", async () => {
  for (const [id, seen] of [["estandar", 1], ["estandar", 999_999], ["icon-single", 29_999], ["icon", 0]] as const) {
    const db = fresh(1_000_000);
    const r = await buyPack(db.client, U, id, `tamper-${id}-${seen}`, undefined, { expectedPrice: seen });
    assert.equal(r.ok, false, `${id} visto ${seen}`); assert.equal(credits(db), 1_000_000, "sin cobro"); assert.equal(gained(db, id), 0);
  }
  // Los sobres sin confirmación obligatoria siguen comprándose sin el campo (clientes antiguos), al precio del servidor.
  const db = fresh(10_000);
  const r = await buyPack(db.client, U, "estandar", "legacy-client");
  assert.ok(r.ok); assert.equal(credits(db), 10_000 - 2_500);
});
