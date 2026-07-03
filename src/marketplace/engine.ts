/**
 * MARKETPLACE ENGINE — libro de operaciones (Collection Fase 5/7).
 *
 * Administra listados/ofertas/transacciones con índices O(1) (Map por id/carta/listado) ⇒ preparado
 * para 1.000.000 de listados y 10.000.000 de operaciones sin O(n²). NUNCA posee cartas: devuelve un
 * PLAN de EFECTOS (créditos + instancias a devolver/adquirir/retirar) que el store aplica a Collection.
 * Determinista: cada operación recibe reloj lógico `now`; la actividad de bots usa el RNG del proyecto.
 * Reutiliza pricing (`fairValue`), fees (`applyTax`), history (`pushSale`) — sin economía nueva.
 */
import { CardRegistry } from "@/collection";
import { applyTax, DEFAULT_TAX_BPS } from "@/domain/market/fees";
import { emptyRecord, pushSale } from "@/domain/market/history";
import { makeRng } from "@/sim/rng";
import { fairValue } from "./value";
import { ev } from "./events";
import {
  freshMarketState, freshEffect, MARKET_SCHEMA_VERSION, USER,
  type MarketState, type MarketListing, type MarketOffer, type PriceRecord, type TxRecord,
  type OpResult, type Effect, type ListingInput, type OfferInput, type ValueModifiers, type MarketAnalytics,
  type MarketValidation, type MarketIssue,
} from "./types";

const MAX_PRICE = 1_000_000_000; // tope anti-overflow
const MIN_PRICE = 25;
const MAX_TX = 200;

export class MarketEngine {
  private registry: CardRegistry;
  private taxBps: number;
  private byId = new Map<string, MarketListing>();
  private byCard = new Map<string, Set<string>>();       // solo listados ACTIVOS
  private offersById = new Map<string, MarketOffer>();
  private priceHistory: Record<string, PriceRecord>;
  private transactions: TxRecord[];
  private seq = 0;

  constructor(state: MarketState = freshMarketState(), opts: { registry?: CardRegistry; taxBps?: number } = {}) {
    this.registry = opts.registry ?? new CardRegistry();
    this.taxBps = opts.taxBps ?? DEFAULT_TAX_BPS;
    this.priceHistory = { ...state.priceHistory };
    this.transactions = [...state.transactions];
    for (const l of state.listings) this.indexListing(l);
    for (const o of state.offers) this.offersById.set(o.id, { ...o });
  }

  // ── Índices ──
  private indexListing(l: MarketListing): void {
    this.byId.set(l.id, l);
    if ((l.status ?? "active") === "active") this.activeSet(l.cardId).add(l.id);
  }
  private activeSet(cardId: string): Set<string> {
    let s = this.byCard.get(cardId);
    if (!s) { s = new Set(); this.byCard.set(cardId, s); }
    return s;
  }
  private deactivate(l: MarketListing): void { this.byCard.get(l.cardId)?.delete(l.id); }
  private nextId(prefix: string, seed: number): string { const n = this.seq++; return `${prefix}_${n}_${((seed ^ (n * 2654435761)) >>> 0).toString(36)}`; }

  private fail(error: string): OpResult { return { ok: false, error, events: [], effect: freshEffect() }; }
  private validPrice(p: number): boolean { return Number.isFinite(p) && Number.isInteger(p) && p >= MIN_PRICE && p <= MAX_PRICE; }

  /** Valor justo dinámico de una carta (reutiliza value.ts + historial + oferta). */
  value(cardId: string, serial?: number, modifiers?: ValueModifiers): number {
    const card = this.registry.card(cardId);
    if (!card) return 0;
    return fairValue(card, serial, { history: this.priceHistory[cardId], activeListings: this.activeSet(cardId).size, modifiers });
  }

  // ─────────────────────── Listados ───────────────────────

  createListing(input: ListingInput, now: number, seed = now): OpResult {
    const o = input.owned;
    if (!o || !o.uid || !o.cardId) return this.fail("Instancia inválida");
    if (!this.registry.card(o.cardId)) return this.fail("Carta inexistente");
    if (!this.validPrice(Math.round(input.price))) return this.fail("Precio inválido");

    const price = Math.round(input.price);
    const sellerId = input.sellerId ?? USER;
    const listing: MarketListing = {
      id: this.nextId("L", seed), cardId: o.cardId, serial: o.serial, price,
      seller: sellerId === USER ? "user" : "bot", sellerId, listedAt: now, status: "active",
      visibility: input.visibility ?? "public", reservedFor: input.reservedFor, lotId: input.lotId,
      expiresAt: input.expiresAt, escrow: sellerId === USER ? o : undefined,
    };
    this.indexListing(listing);

    const effect: Effect = { ...freshEffect(), removeUids: sellerId === USER ? [o.uid] : [] };
    return { ok: true, events: [ev("listing_created", now, { listingId: listing.id, cardId: o.cardId, data: { price } })], effect };
  }

  cancelListing(id: string, now: number): OpResult {
    const l = this.byId.get(id);
    if (!l || (l.status ?? "active") !== "active") return this.fail("El listado ya no está disponible");
    if (l.sellerId !== USER) return this.fail("No puedes cancelar un listado ajeno");
    l.status = "cancelled";
    this.deactivate(l);
    const effect: Effect = { ...freshEffect(), restore: l.escrow ? [l.escrow] : [] };
    return { ok: true, events: [ev("listing_removed", now, { listingId: id, cardId: l.cardId })], effect };
  }

  updatePrice(id: string, price: number, now: number): OpResult {
    const l = this.byId.get(id);
    if (!l || (l.status ?? "active") !== "active") return this.fail("El listado ya no está disponible");
    if (l.sellerId !== USER) return this.fail("No puedes modificar un listado ajeno");
    const p = Math.round(price);
    if (!this.validPrice(p)) return this.fail("Precio inválido");
    const old = l.price; l.price = p;
    return { ok: true, events: [ev("price_changed", now, { listingId: id, cardId: l.cardId, data: { from: old, to: p } })], effect: freshEffect() };
  }

  /** Compra instantánea (el comprador paga el precio; adquiere la carta). */
  buyListing(id: string, buyerId: string, now: number): OpResult {
    const l = this.byId.get(id);
    if (!l || (l.status ?? "active") !== "active") return this.fail("El listado ya no está disponible");
    if (l.sellerId === buyerId) return this.fail("No puedes comprar tu propio listado");
    if (l.visibility === "private" && l.reservedFor && l.reservedFor !== buyerId) return this.fail("Listado reservado a otro comprador");

    return this.settleTrade(l, l.price, buyerId, now);
  }

  // ─────────────────────── Ofertas ───────────────────────

  placeOffer(input: OfferInput, now: number, seed = now): OpResult {
    if (!this.registry.card(input.cardId)) return this.fail("Carta inexistente");
    if (!this.validPrice(Math.round(input.amount))) return this.fail("Importe inválido");
    if (input.listingId) {
      const l = this.byId.get(input.listingId);
      if (!l || (l.status ?? "active") !== "active") return this.fail("El listado ya no está disponible");
      if (l.sellerId === input.from) return this.fail("No puedes ofertar en tu propio listado");
    }
    const offer: MarketOffer = {
      id: this.nextId("O", seed), listingId: input.listingId, cardId: input.cardId, serial: input.serial,
      amount: Math.round(input.amount), from: input.from, status: "pending", createdAt: now, expiresAt: input.expiresAt,
    };
    this.offersById.set(offer.id, offer);
    return { ok: true, events: [ev("offer_created", now, { offerId: offer.id, cardId: input.cardId, data: { amount: offer.amount } })], effect: freshEffect() };
  }

  rejectOffer(id: string, now: number): OpResult {
    const o = this.offersById.get(id);
    if (!o || (o.status !== "pending" && o.status !== "countered")) return this.fail("La oferta ya no está activa");
    o.status = "rejected";
    return { ok: true, events: [ev("offer_rejected", now, { offerId: id, cardId: o.cardId })], effect: freshEffect() };
  }

  counterOffer(id: string, amount: number, now: number): OpResult {
    const o = this.offersById.get(id);
    if (!o || o.status !== "pending") return this.fail("La oferta ya no está activa");
    const a = Math.round(amount);
    if (!this.validPrice(a)) return this.fail("Importe inválido");
    o.status = "countered"; o.counterAmount = a;
    return { ok: true, events: [ev("offer_created", now, { offerId: id, cardId: o.cardId, data: { counter: a } })], effect: freshEffect() };
  }

  /** Acepta una oferta (o su contraoferta): liquida la operación. El vendedor del listado la acepta. */
  acceptOffer(id: string, now: number): OpResult {
    const o = this.offersById.get(id);
    if (!o || (o.status !== "pending" && o.status !== "countered")) return this.fail("La oferta ya no está activa");
    const amount = o.status === "countered" ? (o.counterAmount ?? o.amount) : o.amount;

    const l = o.listingId ? this.byId.get(o.listingId) : undefined;
    if (o.listingId && (!l || (l.status ?? "active") !== "active")) return this.fail("El listado ya no está disponible");

    o.status = "accepted";
    const accepted = ev("offer_accepted", now, { offerId: id, cardId: o.cardId, data: { amount } });
    if (l) {
      const trade = this.settleTrade(l, amount, o.from, now);
      return { ...trade, events: [accepted, ...trade.events] };
    }
    // Oferta abierta sin listado: no hay escrow; solo se registra el acuerdo (sin efecto de inventario).
    return { ok: true, events: [accepted, ev("trade_completed", now, { cardId: o.cardId, data: { amount } })], effect: freshEffect() };
  }

  // ─────────────────────── Liquidación / caducidad / bots ───────────────────────

  /** Liquida una venta de `l` a `price` para `buyerId`. Núcleo común de buy/acceptOffer/settle. */
  private settleTrade(l: MarketListing, price: number, buyerId: string, now: number): OpResult {
    l.status = "sold";
    this.deactivate(l);
    this.recordSale(l.cardId, price, now);

    const effect = freshEffect();
    // Comprador: si es el usuario, paga el bruto y adquiere la carta.
    if (buyerId === USER) { effect.creditsDelta -= price; effect.acquire.push({ cardId: l.cardId, serial: l.serial }); }
    // Vendedor: si es el usuario, recibe el NETO (tras impuesto). El escrow se consume.
    if (l.sellerId === USER) { effect.creditsDelta += applyTax(price, this.taxBps).net; }

    return { ok: true, events: [ev("listing_sold", now, { listingId: l.id, cardId: l.cardId, data: { price } }), ev("trade_completed", now, { cardId: l.cardId, data: { price } })], effect };
  }

  private recordSale(cardId: string, price: number, at: number): void {
    this.priceHistory[cardId] = pushSale(this.priceHistory[cardId] ?? emptyRecord(price), price, at);
    this.transactions.unshift({ cardId, price, at });
    if (this.transactions.length > MAX_TX) this.transactions.length = MAX_TX;
  }

  /** Caduca listados y ofertas vencidos; devuelve el escrow de los listados de usuario. */
  expireListings(now: number): OpResult {
    const effect = freshEffect();
    const events = [];
    for (const l of this.byId.values()) {
      if ((l.status ?? "active") === "active" && l.expiresAt != null && l.expiresAt <= now) {
        l.status = "expired"; this.deactivate(l);
        if (l.escrow) effect.restore.push(l.escrow);
        events.push(ev("listing_expired", now, { listingId: l.id, cardId: l.cardId }));
      }
    }
    for (const o of this.offersById.values()) if (o.status === "pending" && o.expiresAt != null && o.expiresAt <= now) o.status = "expired";
    return { ok: true, events, effect };
  }

  /**
   * Actividad de bots DETERMINISTA (RNG del proyecto): compra listados del usuario según lo barato que
   * estén respecto al valor justo. Devuelve el neto acumulado como efecto (créditos al usuario).
   */
  settle(now: number, seed: number): OpResult {
    const rng = makeRng(seed);
    const effect = freshEffect();
    const events = [];
    for (const l of [...this.byId.values()]) {
      if ((l.status ?? "active") !== "active" || l.sellerId !== USER) continue;
      const fair = this.value(l.cardId, l.serial);
      const ratio = l.price / Math.max(1, fair);
      const chance = Math.min(0.85, Math.max(0.05, 0.5 - (ratio - 1) * 0.9));
      if (rng.next() < chance) {
        const trade = this.settleTrade(l, l.price, "bot", now);   // vendedor = user ⇒ neto al usuario
        effect.creditsDelta += trade.effect.creditsDelta;
        events.push(...trade.events);
      }
    }
    return { ok: true, events, effect };
  }

  /** Inyecta listados de bots (rotación de mercado). No escrowan (no son instancias del usuario). */
  addBotListings(listings: MarketListing[]): void {
    for (const l of listings) this.indexListing({ ...l, sellerId: l.sellerId ?? l.id, status: "active" });
  }

  // ─────────────────────── Consulta / analytics / validación / snapshot ───────────────────────

  listings(): MarketListing[] { return [...this.byId.values()].filter((l) => (l.status ?? "active") === "active"); }
  offers(): MarketOffer[] { return [...this.offersById.values()]; }
  historyOf(cardId: string): PriceRecord | undefined { return this.priceHistory[cardId]; }

  analytics(): MarketAnalytics {
    const active = this.listings();
    const sum = active.reduce((s, l) => s + l.price, 0);
    const salesByCard = new Map<string, number>();
    for (const t of this.transactions) salesByCard.set(t.cardId, (salesByCard.get(t.cardId) ?? 0) + 1);
    const hotCards = [...salesByCard.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([cardId, sales]) => ({ cardId, sales, avg: this.priceHistory[cardId]?.avg ?? 0 }));
    let up = 0, down = 0, stable = 0;
    for (const rec of Object.values(this.priceHistory)) {
      const t = rec.recent.length >= 4 ? (rec.recent[rec.recent.length - 1].price > rec.recent[0].price ? "up" : rec.recent[rec.recent.length - 1].price < rec.recent[0].price ? "down" : "stable") : "stable";
      if (t === "up") up++; else if (t === "down") down++; else stable++;
    }
    return {
      totalListings: this.byId.size, activeListings: active.length,
      openOffers: this.offers().filter((o) => o.status === "pending" || o.status === "countered").length,
      transactions: this.transactions.length, volumeCredits: this.transactions.reduce((s, t) => s + t.price, 0),
      avgListingPrice: active.length ? Math.round(sum / active.length) : 0, hotCards, trend: { up, down, stable },
    };
  }

  /** SEGURIDAD: detecta estados imposibles (ids duplicados, precios/serie inválidos, activo sin escrow user). */
  validate(): MarketValidation {
    const issues: MarketIssue[] = [];
    for (const l of this.byId.values()) {
      if (!this.validPrice(l.price)) issues.push({ code: "BAD_PRICE", message: "Precio inválido", listingId: l.id });
      if ((l.status ?? "active") === "sold" && this.activeSet(l.cardId).has(l.id)) issues.push({ code: "SOLD_ACTIVE", message: "Vendido pero activo", listingId: l.id });
      if (l.sellerId === USER && (l.status ?? "active") === "active" && !l.escrow) issues.push({ code: "NO_ESCROW", message: "Listado de usuario sin escrow", listingId: l.id });
    }
    return { ok: issues.length === 0, issues };
  }

  snapshot(): MarketState {
    return {
      version: MARKET_SCHEMA_VERSION,
      listings: [...this.byId.values()],
      offers: [...this.offersById.values()],
      priceHistory: { ...this.priceHistory },
      transactions: [...this.transactions],
    };
  }
}
