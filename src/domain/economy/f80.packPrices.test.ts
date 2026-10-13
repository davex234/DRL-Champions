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

const F80 = { estandar: 2500, premium: 6000, oro: 12000, masters: 20000, champions: 35000, icon: 60000 } as const;
const F574 = { estandar: 1000, premium: 2500, oro: 4000, masters: 5000, champions: 8000, icon: 12500 } as const;
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
  assert.deepEqual(MAIN_PACK_LINE, ["estandar", "premium", "oro", "masters", "champions", "icon"]);
  assert.deepEqual(Object.fromEntries(MAIN_PACK_LINE.map((id) => [id, getPack(id)!.price])), F80);
  assert.equal(getPack("estandar")!.price, 2500);
  assert.equal(getPack("premium")!.price, 6000);
  assert.equal(getPack("oro")!.price, 12000);
  assert.equal(getPack("masters")!.price, 20000);
  assert.equal(getPack("champions")!.price, 35000);
  assert.equal(getPack("icon")!.price, 60000);
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
  assert.deepEqual(MAIN_PACK_LINE.map((id) => getPack(id)!.cardCount), [5, 6, 5, 5, 5, 3]);
  assert.equal(STARTER_GRANT.credits, 6000);
  assert.deepEqual(STARTER_GRANT.packs, [{ packId: "inicial", qty: 3 }, { packId: "estandar", qty: 1 }]);
  assert.ok(/credits\s+bigint not null default 6000/.test(readFileSync(join(process.cwd(), "supabase/migrations/0001_init.sql"), "utf8")));
  assert.match(readFileSync(join(process.cwd(), "src/store/useGameStore.ts"), "utf8"), /const STARTER_CREDITS = 6000;/);
  assert.equal(PAYMENTS_ENABLED, false);
  assert.equal(GLOBAL_MARKET_ENABLED, false);
});

test("F80 · con los 6.000 iniciales alcanzan Bronce y Plata; Oro, Masters, Champions e Icon no", () => {
  const can = Object.fromEntries(IDS.map((id) => [id, STARTER_GRANT.credits >= getPack(id)!.price]));
  assert.deepEqual(can, { estandar: true, premium: true, oro: false, masters: false, champions: false, icon: false });
});

test("F80 + PACK OPENING 3.0/3.1 · huellas: plan de la línea y su estadística INTACTOS en 3.1; sobres, odds y especiales = 3.1", () => {
  const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v);
  const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(stable(v))).digest("hex");
  const omit = (o: object, k: string) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));
  // Medidas con scripts/_f80-pack-snapshot.ts ANTES de tocar ningún precio (docs/product/qa/f80-pack-prices/).
  // Pack Opening 3.1 · cambian las descripciones de China y EWC (antes c94e9a0a…): precio aparte, nada más en los sobres.
  assert.equal(sha(PACKS.map((p) => omit(p, "price"))), "ec65db3f2f6639687ba2ea59d6667b3882efa802b467900376dcca3e72191a2f", "definición de los sobres sin precio");
  // PACK OPENING 3.0 (2026-10-07) · la tabla F57.3 (huella f755dbdf…) se sustituyó por el plan por ranuras; las odds de
  // la UI (antes 093af671…) y la estadística medida de la línea (antes 4c122a34…) se re-midieron con el plan nuevo.
  assert.equal(sha(MAIN_PACK_PLAN), "1a67322ed778ec71f944ff96797204c3f165be7842993bd1d7f5a757ada4377f", "plan por ranuras Pack Opening 3.0");
  assert.equal(sha(Object.fromEntries(PACKS.map((p) => [p.id, packOddsFor(p, PACK_STATS[p.id] ?? null)]))), "dcbbca45c8a95dc5de1a281efc9e86078d414302dbb7a28487b5f957bc0a7de6", "odds que enseña la UI (3.1: los especiales con plan)");
  // La estadística medida solo cambia en lo que es función del precio (precio y coste por rareza = precio / tasa medida).
  const measured = Object.fromEntries(Object.entries(PACK_STATS).map(([id, s]) => [id, omit(omit(s, "price"), "costPerRarity")]));
  assert.equal(sha(measured), "a0baa697e3ca4b91039cfd72a8b839a336aedbdd04b25006f5c987516c364908", "reparto, valor y desguace medidos (20.000 aperturas, semilla 90210)");
  // La línea principal NO cambia en 3.1: su estadística medida es la misma que dejó Pack Opening 3.0.
  const main = Object.fromEntries(MAIN_PACK_LINE.map((id) => [id, omit(omit(PACK_STATS[id], "price"), "costPerRarity")]));
  assert.equal(sha(main), "e899c1d21873a5d67b0999217a9ccf04088dea1cfbdc9700b2df6992d4b60c53", "línea principal intacta");
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
    const r1 = await buyPack(poor.client, U, id, `edge-${id}`);
    assert.equal(r1.ok, false); assert.equal(!r1.ok && r1.status, 409); assert.equal(!r1.ok && r1.error, "Créditos insuficientes");
    assert.equal(credits(poor), price - 1); assert.equal(gained(poor, id), 0); assert.equal(debits(poor, id).length, 0);

    const exact = fresh(price);
    const r2 = await buyPack(exact.client, U, id, `edge-${id}`);
    assert.ok(r2.ok, r2.ok ? "" : r2.error);
    assert.equal(credits(exact), 0, "cobra exactamente el precio");
    assert.equal(gained(exact, id), 1, "concede exactamente un sobre");
    assert.equal(debits(exact, id).length, 1); assert.equal(Number(debits(exact, id)[0].delta), -price);
  });

  test(`F80 · ${id}: reintento con el mismo gesto no cobra ni concede dos veces; el precio ANTIGUO no compra`, async () => {
    const db = fresh(200_000);
    const a = await buyPack(db.client, U, id, `retry-${id}`);
    const b = await buyPack(db.client, U, id, `retry-${id}`);
    assert.ok(a.ok && b.ok);
    assert.equal(credits(db), 200_000 - price); assert.equal(gained(db, id), 1); assert.equal(debits(db, id).length, 1);
    // Un cliente que «sabe» el precio de F57.4 y solo tiene ese saldo: el servidor exige el nuevo.
    const old = fresh(F574[id]);
    const c = await buyPack(old.client, U, id, `old-${id}`);
    assert.equal(c.ok, false); assert.equal(credits(old), F574[id]); assert.equal(gained(old, id), 0);
  });

  test(`F80 · ${id}: la tienda (POST /api/game/store) muestra y cobra el MISMO precio que el servidor`, async () => {
    const product = findStoreProduct(`pack:${id}`, Date.now(), STORE_CATALOG)!;
    assert.ok(product, `pack:${id} en la tienda`);
    assert.equal(optionFor(product, "GAME_CURRENCY")?.price, price, "precio mostrado = precio cobrado");
    assert.equal(formatCredits(price), price.toLocaleString("de-DE"), "formato 2.500 / 60.000 (enteros, punto de miles)");
    const db = fresh(price);
    const r = await storeCheckout(db.client, U, { productId: `pack:${id}`, method: "GAME_CURRENCY", ref: `store-${id}` }, { buyPack, now: () => Date.now(), catalog: STORE_CATALOG });
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.equal(credits(db), 0); assert.equal(gained(db, id), 1);
  });
}

test("F80 · dos pestañas, saldo para UNA sola compra de Icon: una entra, la otra se rechaza; nunca saldo negativo", async () => {
  const db = fresh(60_000);
  const [a, b] = await Promise.all([buyPack(db.client, U, "icon", "tab-a"), buyPack(db.client, U, "icon", "tab-b")]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.equal(credits(db), 0); assert.equal(gained(db, "icon"), 1); assert.equal(debits(db, "icon").length, 1);
});

test("F80 · el cliente no decide el precio: ni la ruta de sobres ni la de tienda aceptan un campo de precio", () => {
  const packsRoute = readFileSync(join(process.cwd(), "src/app/api/game/packs/route.ts"), "utf8");
  const storeRoute = readFileSync(join(process.cwd(), "src/app/api/game/store/route.ts"), "utf8");
  assert.match(packsRoute, /const ALLOWED = \["action", "packId", "ref"\];/);
  assert.match(packsRoute, /Object\.keys\(body\)\.some\(\(k\) => !ALLOWED\.includes\(k\)\)/);
  assert.match(storeRoute, /const ALLOWED = \["action", "productId", "method", "ref"\];/);
  // El servicio pasa a la RPC el precio del CATÁLOGO DEL SERVIDOR, nunca un argumento del cliente.
  const svc = readFileSync(join(process.cwd(), "src/server/services/packs.ts"), "utf8");
  assert.match(svc, /p_price: pack\.price,/);
});
