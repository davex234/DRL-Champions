import test from "node:test";
import assert from "node:assert/strict";
import { STORE_CATALOG } from "@/data/storeCatalog";
import { PACKS, getPack } from "@/data/packs";
import { CARDS, getCard } from "@/data/catalog";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { PAYMENTS_ENABLED } from "@/config/monetization";
import { isPurchasable } from "@/domain/packs/lifecycle";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
import {
  STORE_CAPABILITIES, findStoreProduct, inWindow, optionFor, resolveAll, resolveStore, validateStoreCatalog,
} from "./resolve";
import { BOX_PACK_COUNT, type StoreCapabilities, type StoreCatalogConfig } from "./types";

const NOW = Date.parse("2026-09-21T12:00:00Z");
const clone = (): StoreCatalogConfig => JSON.parse(JSON.stringify(STORE_CATALOG));

test("CONFIGURACIÓN · todo lo que nombra existe y es coherente (0 problemas)", () => {
  assert.deepEqual(validateStoreCatalog(), []);
});

test("CONFIGURACIÓN · el validador detecta referencias rotas, sobres no vendibles, precios y ventanas malos", () => {
  const cfg = clone();
  cfg.cardOffers.push({ id: "x", cardId: "no-existe__base", featured: false, enabled: true, sortOrder: 1, purchaseMode: "BOTH" });
  cfg.packOffers.push({ id: "tyl", packId: "team-tyl", enabled: true, sortOrder: 1, purchaseMode: "BOTH" });
  cfg.boxOffers.push({ id: "caja-x", name: "X", packId: "prime", enabled: true, sortOrder: 1, purchaseMode: "REAL_MONEY", realMoneyPrice: { cents: -5, currency: "EUR" } });
  cfg.bundleOffers.push({ id: "b", name: "B", tagline: "", enabled: true, sortOrder: 1, purchaseMode: "REAL_MONEY", startAt: "2026-10-01", endAt: "2026-09-01", contents: { packs: [{ packId: "estandar", count: 0 }], cardIds: [], credits: 0 } });
  const issues = validateStoreCatalog(cfg).join("\n");
  assert.match(issues, /carta inexistente no-existe__base/);
  assert.match(issues, /sobre no vendible \(DRAFT\) team-tyl/);
  assert.match(issues, /sobre no vendible .* prime/);
  assert.match(issues, /precio en euros no válido/);
  assert.match(issues, /ventana vacía/);
  assert.match(issues, /cantidad no válida de estandar/);
});

test("SOBRES · solo sobres reales, ACTIVOS; DRAFT (TYL, XLG, …) y RETIRED nunca se enseñan ni se venden", () => {
  const view = resolveStore(NOW);
  assert.ok(view.packs.length >= 10);
  for (const p of view.packs) {
    const pack = getPack(p.packId!)!;
    assert.ok(pack && isPurchasable(pack), p.productId);
  }
  // Aunque alguien los configurara, el ciclo de vida manda.
  const cfg = clone();
  for (const id of ["team-tyl", "team-xlg", "team-loud", "prime"]) cfg.packOffers.push({ id, packId: id, enabled: true, sortOrder: 1, purchaseMode: "BOTH" });
  const all = resolveAll(NOW, cfg);
  for (const id of ["team-tyl", "team-xlg", "team-loud", "prime"]) {
    assert.equal(all.find((p) => p.productId === `pack:${id}`)!.status, "DISABLED", id);
    assert.ok(!resolveStore(NOW, cfg).packs.some((p) => p.packId === id), id);
  }
});

test("SOBRES · el precio en créditos es el del sobre (una sola autoridad) y se compra hoy; el dinero real, pendiente", () => {
  for (const p of resolveStore(NOW).packs) {
    const credits = optionFor(p, "GAME_CURRENCY")!;
    assert.equal(credits.price, getPack(p.packId!)!.price);
    assert.equal(credits.status, "AVAILABLE");
    const money = optionFor(p, "REAL_MONEY");
    if (money) assert.equal(money.status, PAYMENTS_ENABLED ? "PRICE_PENDING" : "CHECKOUT_PENDING");
  }
});

test("CAJAS · 1 caja = 10 sobres de un tipo real, sin abrir; solo dinero real, sin pasarela = no se vende", () => {
  const { boxes } = resolveStore(NOW);
  assert.ok(boxes.length >= 3);
  for (const b of boxes) {
    assert.deepEqual(b.grant, { packs: [{ packId: b.packId!, count: BOX_PACK_COUNT }], cardIds: [], credits: 0 });
    assert.equal(BOX_PACK_COUNT, 10);
    assert.ok(isPurchasable(getPack(b.packId!)!));
    assert.deepEqual(b.options.map((o) => o.method), ["REAL_MONEY"]);
    assert.equal(b.status, "COMING_SOON");
  }
});

test("CARTAS · ofertas de la casa con cartas REALES, mezcla de rarezas; NO es el Marketplace", () => {
  assert.equal(GLOBAL_MARKET_ENABLED, false);
  const { cards } = resolveStore(NOW);
  assert.ok(cards.length >= 4);
  const buckets = new Set(cards.map((c) => bucketForRank(getVariant(getCard(c.cardId!)!.variantId).rank)));
  for (const b of ["legendary", "epic", "rare", "uncommon"]) assert.ok(buckets.has(b as never), b);
  for (const c of cards) {
    assert.ok(CARDS.some((x) => x.id === c.cardId));
    assert.deepEqual(c.grant.cardIds, [c.cardId]);
    // Sin precio decidido: nada se vende todavía, ni por créditos ni por euros.
    assert.equal(c.status, "COMING_SOON");
  }
});

test("PACKS ESPECIALES · contenido explícito de recursos existentes; distinto de una caja", () => {
  const { bundles } = resolveStore(NOW);
  assert.ok(bundles.length >= 1);
  for (const b of bundles) {
    for (const x of b.grant.packs) assert.ok(getPack(x.packId), x.packId);
    for (const id of b.grant.cardIds) assert.ok(getCard(id), id);
    assert.ok(b.grant.credits >= 0);
  }
});

test("HÉROE · edición real y cartas reales del catálogo; sin cuenta atrás si no hay fecha", () => {
  const { hero } = resolveStore(NOW);
  assert.ok(hero);
  assert.equal(hero!.editionId, "champions-s");
  for (const id of hero!.cardIds) assert.equal(getCard(id)!.variantId, "champions-s", id);
  assert.equal(hero!.endAt, undefined);
});

test("VENTANAS · fuera de fecha la oferta no existe; con fechas ilegibles, tampoco", () => {
  assert.equal(inWindow({}, NOW), true);
  assert.equal(inWindow({ startAt: "2026-10-01T00:00:00Z" }, NOW), false);
  assert.equal(inWindow({ endAt: "2026-09-01T00:00:00Z" }, NOW), false);
  assert.equal(inWindow({ startAt: "mañana" }, NOW), false);
  const cfg = clone();
  cfg.packOffers[0].endAt = "2026-09-01T00:00:00Z";
  assert.equal(findStoreProduct(`pack:${cfg.packOffers[0].id}`, NOW, cfg)!.status, "DISABLED");
});

test("IDS · el servidor solo reconoce ids con forma y existentes", () => {
  for (const bad of ["", "premium", "pack:", "pack:PREMIUM", "pack:../x", "box:caja-masters;drop", "gem:1", "pack:no-existe"]) {
    assert.equal(findStoreProduct(bad, NOW), null, bad);
  }
  assert.ok(findStoreProduct("pack:premium", NOW));
  assert.ok(findStoreProduct("box:caja-masters", NOW));
  assert.ok(findStoreProduct("card:mada__moments", NOW));
});

test("FUTURO · con pasarela y precios, el dinero real pasa a disponible SIN reescribir productos", () => {
  const caps: StoreCapabilities = { ...STORE_CAPABILITIES, realMoneyCheckout: true };
  const cfg = clone();
  cfg.boxOffers[0].realMoneyPrice = { cents: 999, currency: "EUR" };
  cfg.cardOffers[0].gameCurrencyPrice = 5000;
  const box = findStoreProduct(`box:${cfg.boxOffers[0].id}`, NOW, cfg, caps)!;
  assert.deepEqual(optionFor(box, "REAL_MONEY"), { method: "REAL_MONEY", price: 999, status: "AVAILABLE" });
  // Créditos por una carta: con precio, pero el servidor aún no sabe entregarla → pendiente, no «disponible».
  const card = findStoreProduct(`card:${cfg.cardOffers[0].id}`, NOW, cfg, caps)!;
  assert.deepEqual(optionFor(card, "GAME_CURRENCY"), { method: "GAME_CURRENCY", price: 5000, status: "FULFILMENT_PENDING" });
});

test("NADA SE CUELA · la configuración no toca precios de sobres ni el catálogo", () => {
  assert.equal(CARDS.length, 331);
  assert.equal(new Set(CARDS.map((c) => c.playerId)).size, 196);
  // F80: precios de la línea principal decididos por producto (2.500 / 6.000 / 12.000 / 20.000 / 35.000 / 60.000).
  assert.equal(getPack("estandar")!.price, 2500);
  assert.equal(getPack("premium")!.price, 6000);
  assert.ok(PACKS.filter((p) => p.lifecycle === "DRAFT").every((p) => !isPurchasable(p)));
});
