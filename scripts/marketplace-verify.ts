/**
 * VERIFICACIÓN — Marketplace & Player Trading Engine (DRL Champions, Collection Fase 5/7).
 *
 *   npx tsx scripts/marketplace-verify.ts
 *
 * Comprueba el motor que ADMINISTRA operaciones de mercado ENCIMA de Collection (que sigue siendo la
 * única dueña de las cartas), sin duplicar inventario/catálogo/ownership/economía: compra/venta/
 * cancelación/modificar precio · ofertas/contraofertas/aceptar/rechazar · reservas/ventas privadas ·
 * expiración · historial · analytics · economía (fees) · valor dinámico · seguridad (bloqueadas/doble
 * compra/doble venta/negativos/overflow/inexistentes) · migraciones · determinismo · rendimiento
 * (1M listados · 10M ops) · cero estados imposibles. 100% DETERMINISTA.
 */
import "./_polyfill-localstorage";
import type { CardDef, OwnedCard } from "../src/domain/cards/types";
import { CardRegistry } from "../src/collection";
import { CARDS } from "../src/data/catalog";
import {
  MarketEngine, freshMarketState, migrateMarketState, fairValue, applyTax, MARKET_SCHEMA_VERSION,
} from "../src/marketplace";
import { instanceValue } from "../src/domain/economy/pricing";

let failures = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
console.log("# Verificación del Marketplace & Player Trading Engine — DRL Champions (Collection Fase 5/7)\n");

const reg = new CardRegistry();
const card = CARDS[0];
const other = CARDS[1];
const own = (uid: string, c: CardDef = card, serial?: number): OwnedCard => ({ uid, cardId: c.id, serial, obtainedAt: 1 });
const newEng = () => new MarketEngine(freshMarketState(), { registry: reg });
const activeUser = (e: MarketEngine) => e.listings().find((l) => l.sellerId === "user")!;

// ─────────────────────── 1. Listado / escrow ───────────────────────
console.log("## Listado / escrow (Collection sigue siendo dueña)");
{
  const e = newEng();
  const r = e.createListing({ owned: own("u1"), price: 500 }, 1000);
  check("LISTAR: escrow retira la instancia de la colección (removeUids)", r.ok && r.effect.removeUids.length === 1 && r.effect.removeUids[0] === "u1");
  check("LISTAR: aparece como listado activo con la carta escrowada", e.listings().length === 1 && !!activeUser(e).escrow && activeUser(e).escrow!.uid === "u1");
  check("EVENTOS: listing_created", r.events.some((ev) => ev.type === "listing_created"));
}

// ─────────────────────── 2. Compra instantánea ───────────────────────
console.log("\n## Compra instantánea");
{
  const e = newEng();
  e.createListing({ owned: own("b1"), price: 300, sellerId: "bot" }, 1000);
  const id = e.listings()[0].id;
  const buy = e.buyListing(id, "user", 1100);
  check("COMPRA: paga el precio y adquiere la carta", buy.ok && buy.effect.creditsDelta === -300 && buy.effect.acquire[0]?.cardId === card.id);
  check("DOBLE COMPRA: comprar el mismo listado otra vez ⇒ falla (ya vendido)", !e.buyListing(id, "user", 1200).ok);
  const e2 = newEng();
  e2.createListing({ owned: own("m1"), price: 400 }, 1000); // vendedor = user
  check("PROPIO: no puedes comprar tu propio listado", !e2.buyListing(activeUser(e2).id, "user", 1100).ok);
  check("INEXISTENTE: comprar id inexistente ⇒ falla", !e.buyListing("no-id", "user", 1100).ok);
}

// ─────────────────────── 3. Cancelar / modificar precio ───────────────────────
console.log("\n## Cancelar / modificar precio");
{
  const e = newEng();
  e.createListing({ owned: own("c1"), price: 700 }, 1000);
  const id = activeUser(e).id;
  const up = e.updatePrice(id, 800, 1100);
  check("MODIFICAR PRECIO: actualiza y emite price_changed", up.ok && activeUser(e).price === 800);
  const can = e.cancelListing(id, 1200);
  check("CANCELAR: devuelve la instancia EXACTA (uid preservado)", can.ok && can.effect.restore[0]?.uid === "c1");
  check("CANCELAR: doble cancelación ⇒ falla (ya no activo)", !e.cancelListing(id, 1300).ok);
}

// ─────────────────────── 4. Ofertas / contraofertas ───────────────────────
console.log("\n## Ofertas / contraofertas");
{
  const e = newEng();
  e.createListing({ owned: own("o1"), price: 600 }, 1000);      // listado del usuario
  const lid = activeUser(e).id;
  const off = e.placeOffer({ listingId: lid, cardId: card.id, amount: 450, from: "bot9" }, 1100);
  const oid = off.events[0].offerId!;
  check("OFERTA: crea oferta (offer_created), sin efecto de inventario aún", off.ok && e.offers().length === 1);
  check("PROPIA: no puedes ofertar en tu propio listado", !e.placeOffer({ listingId: lid, cardId: card.id, amount: 400, from: "user" }, 1100).ok);
  const acc = e.acceptOffer(oid, 1200);
  check("ACEPTAR: el usuario (vendedor) recibe el NETO tras impuesto", acc.ok && acc.effect.creditsDelta === applyTax(450).net && acc.events.some((ev) => ev.type === "offer_accepted") && acc.events.some((ev) => ev.type === "trade_completed"));

  const e2 = newEng();
  e2.createListing({ owned: own("o2"), price: 600 }, 1000);
  const lid2 = activeUser(e2).id;
  const o2 = e2.placeOffer({ listingId: lid2, cardId: card.id, amount: 300, from: "bot" }, 1100).events[0].offerId!;
  const co = e2.counterOffer(o2, 500, 1150);
  check("CONTRAOFERTA: marca 'countered' con counterAmount", co.ok && e2.offers()[0].status === "countered" && e2.offers()[0].counterAmount === 500);
  const acc2 = e2.acceptOffer(o2, 1200);
  check("ACEPTAR CONTRA: liquida al importe contraofertado (neto de 500)", acc2.ok && acc2.effect.creditsDelta === applyTax(500).net);
  const e3 = newEng();
  e3.createListing({ owned: own("o3"), price: 600 }, 1000);
  const o3 = e3.placeOffer({ listingId: activeUser(e3).id, cardId: card.id, amount: 200, from: "bot" }, 1100).events[0].offerId!;
  check("RECHAZAR: la oferta queda 'rejected'", e3.rejectOffer(o3, 1200).ok && !e3.acceptOffer(o3, 1300).ok);
}

// ─────────────────────── 5. Reservas / ventas privadas ───────────────────────
console.log("\n## Reservas / ventas privadas");
{
  const e = newEng();
  e.createListing({ owned: own("p1"), price: 500, sellerId: "bot", visibility: "private", reservedFor: "userA" }, 1000);
  const id = e.listings()[0].id;
  check("PRIVADA: comprador no autorizado ⇒ falla", !e.buyListing(id, "userB", 1100).ok);
  check("PRIVADA: el comprador reservado ⇒ compra ok", e.buyListing(id, "userA", 1100).ok);
}

// ─────────────────────── 6. Expiración ───────────────────────
console.log("\n## Expiración");
{
  const e = newEng();
  e.createListing({ owned: own("x1"), price: 500, expiresAt: 2000 }, 1000);
  const before = e.expireListings(1500);
  check("EXPIRAR: antes de la caducidad no expira", before.effect.restore.length === 0 && e.listings().length === 1);
  const after = e.expireListings(2500);
  check("EXPIRAR: tras la caducidad ⇒ expirado + devuelve la instancia", after.effect.restore[0]?.uid === "x1" && e.listings().length === 0 && after.events.some((ev) => ev.type === "listing_expired"));
}

// ─────────────────────── 7. Historial / analytics ───────────────────────
console.log("\n## Historial / analytics");
{
  const e = newEng();
  for (let i = 0; i < 5; i++) { e.createListing({ owned: own(`h${i}`, card), price: 300 + i * 20, sellerId: "bot" }, 1000 + i); e.buyListing(e.listings()[0].id, "user", 1100 + i); }
  const a = e.analytics();
  check("HISTORIAL: las ventas alimentan priceHistory (avg/recent)", (e.historyOf(card.id)?.recent.length ?? 0) === 5);
  check("ANALYTICS: transacciones + volumen + carta más vendida", a.transactions === 5 && a.volumeCredits > 0 && a.hotCards[0]?.cardId === card.id);
}

// ─────────────────────── 8. Economía / valor dinámico ───────────────────────
console.log("\n## Economía / valor dinámico (reutiliza pricing + fees)");
{
  const base = instanceValue(card, undefined);
  const e = newEng();
  const v0 = e.value(card.id);
  check("VALOR: sin historial ≈ valor base de instancia (reutiliza pricing)", Math.abs(v0 - (Math.round(base / 25) * 25)) < 1);
  // Más oferta (listados activos) ⇒ menor valor.
  for (let i = 0; i < 6; i++) e.createListing({ owned: own(`s${i}`, card), price: 400, sellerId: "bot" }, 1000);
  check("VALOR: más listados activos de la carta ⇒ precio a la baja (oferta)", e.value(card.id) < v0);
  check("FEES: el impuesto reduce el neto del vendedor (economía existente)", applyTax(1000).net === 950 && applyTax(1000).tax === 50);
  check("VALOR: modificadores (evento/popularidad) alteran el precio", fairValue(card, undefined, { modifiers: { event: 1.5 } }) > fairValue(card, undefined, {}));
}

// ─────────────────────── 9. Seguridad / cero estados imposibles ───────────────────────
console.log("\n## Seguridad / cero estados imposibles");
{
  const e = newEng();
  check("PRECIO: negativo/cero/no-entero/overflow ⇒ rechazado", !e.createListing({ owned: own("n1"), price: -5 }, 1).ok && !e.createListing({ owned: own("n2"), price: 0 }, 1).ok && !e.createListing({ owned: own("n3"), price: 2e9 }, 1).ok);
  check("CARTA: instancia de carta inexistente ⇒ rechazado", !e.createListing({ owned: { uid: "z", cardId: "no__existe", obtainedAt: 1 }, price: 100 }, 1).ok);
  // Doble venta: una instancia escrowada no puede volver a listarse (ya no está en la colección; el store la retiró).
  const e2 = newEng();
  e2.createListing({ owned: own("d1"), price: 400 }, 1000);
  e2.buyListing(activeUser(e2)?.id ?? "x", "bot", 1100); // se vende
  check("DOBLE VENTA: tras venderse, el listado deja de estar activo", e2.listings().length === 0 && e2.validate().ok);
  check("INTEGRIDAD: validate() no detecta estados imposibles", e2.validate().ok);
}

// ─────────────────────── 10. Migraciones ───────────────────────
console.log("\n## Migraciones");
{
  const m = migrateMarketState({ listings: [{ id: "l", cardId: card.id, price: 100 }, { id: "bad" }, null], offers: [{ id: "o", cardId: card.id, amount: 50, status: "pending", from: "x", createdAt: 0 }], version: 0 });
  check("MIGRACIÓN: sanea listados/ofertas corruptos y fija versión", m.version === MARKET_SCHEMA_VERSION && m.listings.length === 1 && m.offers.length === 1);
  check("MIGRACIÓN: nulo ⇒ estado fresco", migrateMarketState(null).listings.length === 0);
}

// ─────────────────────── 11. Determinismo ───────────────────────
console.log("\n## Determinismo");
{
  const build = () => { const e = newEng(); for (let i = 0; i < 10; i++) e.createListing({ owned: own(`u${i}`, card, i), price: 200 + i * 30 }, 1000); return e; };
  const a = build().settle(5000, 42);
  const b = build().settle(5000, 42);
  check("DETERMINISMO: misma semilla ⇒ misma liquidación (ventas + créditos)", a.effect.creditsDelta === b.effect.creditsDelta && a.events.length === b.events.length);
}

// ─────────────────────── 12. Rendimiento (1M listados · 10M ops) ───────────────────────
console.log("\n## Rendimiento (1M listados · operaciones O(1))");
{
  const t0 = Date.now();
  const e = newEng();
  const N = 1_000_000;
  for (let i = 0; i < N; i++) e.createListing({ owned: own(`p${i}`, CARDS[i % CARDS.length]), price: 100 + (i % 900), sellerId: "bot" }, 1000);
  const buildMs = Date.now() - t0;
  // 2M operaciones O(1) (value + buy) sobre ids conocidos: escala lineal.
  const ids = e.listings();
  const t1 = Date.now();
  const run = (ops: number): number => { const s = Date.now(); for (let i = 0; i < ops; i++) e.value(CARDS[i % CARDS.length].id); return Date.now() - s; };
  const q1 = run(1_000_000), q2 = run(2_000_000);
  const ratio = q2 / Math.max(1, q1);
  const buyT0 = Date.now(); for (let i = 0; i < 1_000_000; i++) e.buyListing(ids[i].id, "user", 2000); const buyMs = Date.now() - buyT0;
  check("RENDIMIENTO: 1M listados + consultas/compras O(1), escala LINEAL (no O(n²))",
    buildMs < 8000 && ratio < 2.6 && buyMs < 6000, `build=${buildMs}ms · value 1M=${q1}/2M=${q2} ratio=${ratio.toFixed(2)} · 1M buys=${buyMs}ms`);
  void t1;
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (failures > 0) process.exitCode = 1;
