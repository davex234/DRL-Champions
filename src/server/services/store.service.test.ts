import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STORE_CATALOG } from "@/data/storeCatalog";
import type { StoreCatalogConfig } from "@/domain/store/types";
import { storeCheckout, type StoreDeps } from "./store";

const NOW = Date.parse("2026-09-21T12:00:00Z");
const sb = {} as SupabaseClient;

function deps(over: Partial<StoreDeps> = {}) {
  const calls: { packId: string; ref?: string }[] = [];
  const d: StoreDeps = {
    now: () => NOW,
    catalog: STORE_CATALOG,
    buyPack: async (_sb, _uid, packId, ref) => { calls.push({ packId, ref }); return { ok: true, data: { credits: 1000, packId, qty: 1 } }; },
    ...over,
  };
  return { d, calls };
}

test("CRÉDITOS · un sobre se compra por el servicio de siempre, con el sobre que dice el SERVIDOR", async () => {
  const { d, calls } = deps();
  const r = await storeCheckout(sb, "u1", { productId: "pack:premium", method: "GAME_CURRENCY", ref: "g1" }, d);
  assert.ok(r.ok);
  assert.deepEqual(calls, [{ packId: "premium", ref: "g1" }]);
  assert.deepEqual(r.ok && r.data, { kind: "PACK_PURCHASED", productId: "pack:premium", credits: 1000, packId: "premium", qty: 1 });
});

test("REPLAY · el mismo gesto viaja tal cual a la RPC idempotente (no se inventa uno nuevo)", async () => {
  const { d, calls } = deps();
  await storeCheckout(sb, "u1", { productId: "pack:estandar", method: "GAME_CURRENCY", ref: "same" }, d);
  await storeCheckout(sb, "u1", { productId: "pack:estandar", method: "GAME_CURRENCY", ref: "same" }, d);
  assert.deepEqual(calls.map((c) => c.ref), ["same", "same"]);
});

test("INEXISTENTE · id desconocido o con otra forma → 404, sin tocar la economía", async () => {
  const { d, calls } = deps();
  for (const productId of ["pack:no-existe", "card:nadie__base", "box:caja-x", "pack:premium;x", "gem:100"]) {
    const r = await storeCheckout(sb, "u1", { productId, method: "GAME_CURRENCY" }, d);
    assert.equal(!r.ok && r.status, 404, productId);
  }
  assert.equal(calls.length, 0);
});

test("DESHABILITADO Y FUERA DE FECHA · 410, sin cobrar", async () => {
  const cfg: StoreCatalogConfig = JSON.parse(JSON.stringify(STORE_CATALOG));
  cfg.packOffers.find((o) => o.id === "premium")!.enabled = false;
  cfg.packOffers.find((o) => o.id === "estandar")!.endAt = "2026-09-01T00:00:00Z";
  cfg.packOffers.push({ id: "team-tyl", packId: "team-tyl", enabled: true, sortOrder: 1, purchaseMode: "BOTH" });
  const { d, calls } = deps({ catalog: cfg });
  for (const productId of ["pack:premium", "pack:estandar", "pack:team-tyl"]) {
    const r = await storeCheckout(sb, "u1", { productId, method: "GAME_CURRENCY" }, d);
    assert.equal(!r.ok && r.status, 410, productId);
  }
  assert.equal(calls.length, 0);
});

test("DINERO REAL · sin pasarela: 503 y NADA concedido, para cualquier producto", async () => {
  const { d, calls } = deps();
  for (const productId of ["pack:premium", "box:caja-masters", "box:caja-champions", "card:mada__moments", "bundle:pack-inicio"]) {
    const r = await storeCheckout(sb, "u1", { productId, method: "REAL_MONEY" }, d);
    assert.equal(!r.ok && r.status, 503, productId);
  }
  assert.equal(calls.length, 0);
});

test("CAJA · no se compra con créditos (método no ofrecido) y NUNCA abre sobres", async () => {
  const { d, calls } = deps();
  const r = await storeCheckout(sb, "u1", { productId: "box:caja-masters", method: "GAME_CURRENCY" }, d);
  assert.equal(!r.ok && r.status, 400);
  assert.equal(calls.length, 0);
});

test("CARTA / PACK ESPECIAL · sin precio o sin entrega por créditos → 409, sin cobrar", async () => {
  const { d, calls } = deps();
  const card = await storeCheckout(sb, "u1", { productId: "card:mada__moments", method: "GAME_CURRENCY" }, d);
  assert.equal(!card.ok && card.status, 409);
  const cfg: StoreCatalogConfig = JSON.parse(JSON.stringify(STORE_CATALOG));
  cfg.cardOffers[0].gameCurrencyPrice = 1; // aunque alguien le ponga precio, el servidor no sabe entregarla aún
  const priced = await storeCheckout(sb, "u1", { productId: `card:${cfg.cardOffers[0].id}`, method: "GAME_CURRENCY" }, deps({ catalog: cfg }).d);
  assert.equal(!priced.ok && priced.status, 409);
  assert.equal(calls.length, 0);
});

test("SALDO INSUFICIENTE · el rechazo de la RPC llega tal cual (el servidor es la autoridad)", async () => {
  const { d } = deps({ buyPack: async () => ({ ok: false, error: "Créditos insuficientes", status: 402 }) });
  const r = await storeCheckout(sb, "u1", { productId: "pack:icon", method: "GAME_CURRENCY" }, d);
  assert.deepEqual(r, { ok: false, error: "Créditos insuficientes", status: 402 });
});

test("RUTA · solo acepta action/productId/method/ref: precio, cantidad, cartas o contenido se RECHAZAN", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/game/store/route.ts"), "utf8");
  assert.match(src, /const ALLOWED = \["action", "productId", "method", "ref"\];/);
  assert.match(src, /Object\.keys\(body\)\.some\(\(k\) => !ALLOWED\.includes\(k\)\)/);
  assert.match(src, /const session = await getSession\(req\);\s*if \(!session\)/);
  assert.match(src, /storeCheckout\(session\.admin, session\.userId, \{ productId, method, ref \}\)/);
  assert.ok(!/body\.(price|qty|quantity|count|cardId|contents|credits|userId)/.test(src));
});
