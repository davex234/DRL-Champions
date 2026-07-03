"use client";

/**
 * MARKETPLACE STORE — evoluciona el mercado de cartas para usar el Marketplace Engine (Fase 5/7).
 *
 * El motor (`@/marketplace`) administra listados/ofertas/historial con índices O(1) y es DETERMINISTA
 * (semilla + reloj inyectados). El store solo persiste el estado y APLICA los efectos a Collection
 * (`useGameStore`), que sigue siendo la ÚNICA dueña de las cartas. Mantiene la API que consume la UI
 * (listings/priceHistory/buyListing/listForSale/cancelListing/sales/purchases) y añade ofertas/
 * contraofertas/expiración/analytics. Nunca vende cartas bloqueadas.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { MarketListing, MarketOffer, PriceRecord, TxRecord, MarketAnalytics, Effect } from "@/marketplace";
import { MarketEngine, migrateMarketState, MARKET_SCHEMA_VERSION } from "@/marketplace";
import { seedPriceHistory, generateBotListings } from "@/data/marketSeed";
import { makeRng, seedFrom } from "@/sim/rng";
import { useGameStore } from "./useGameStore";
import { useEventsStore } from "./useEventsStore";

const TARGET_BOT_LISTINGS = 54;
const rngFrom = (seed: number): (() => number) => { const r = makeRng(seed); return () => r.next(); };

interface MarketState {
  seeded: boolean;
  lastRefresh: number;
  // Estado del motor (persistible).
  listings: MarketListing[];
  offers: MarketOffer[];
  priceHistory: Record<string, PriceRecord>;
  transactions: TxRecord[];
  // Conveniencia de UI (perspectiva del usuario).
  purchases: TxRecord[];
  sales: TxRecord[];

  ensureSeeded: () => void;
  refreshMarket: () => void;
  buyListing: (id: string) => { ok: boolean; error?: string };
  listForSale: (uid: string, price: number, opts?: { visibility?: "public" | "private"; reservedFor?: string; expiresAt?: number }) => { ok: boolean; error?: string };
  updatePrice: (id: string, price: number) => { ok: boolean; error?: string };
  cancelListing: (id: string) => void;
  placeOffer: (cardId: string, amount: number, listingId?: string) => { ok: boolean; error?: string; offerId?: string };
  acceptOffer: (id: string) => { ok: boolean; error?: string };
  rejectOffer: (id: string) => void;
  counterOffer: (id: string, amount: number) => { ok: boolean; error?: string };
  expireMarket: () => void;
  analytics: () => MarketAnalytics;
  resetMarket: () => void;
}

export const useMarketStore = create<MarketState>()(
  persist(
    (set, get) => {
      const engine = (): MarketEngine =>
        new MarketEngine({ version: MARKET_SCHEMA_VERSION, listings: get().listings, offers: get().offers, priceHistory: get().priceHistory, transactions: get().transactions });

      const commit = (eng: MarketEngine): void => {
        const snap = eng.snapshot();
        set({
          listings: snap.listings.filter((l) => (l.status ?? "active") === "active"),
          offers: snap.offers.filter((o) => o.status === "pending" || o.status === "countered"),
          priceHistory: snap.priceHistory,
          transactions: snap.transactions,
        });
      };

      // Aplica los efectos del motor a Collection/moneda (única fuente de propiedad = useGameStore).
      const applyEffect = (effect: Effect): void => {
        const game = useGameStore.getState();
        if (effect.creditsDelta) game.addCredits(effect.creditsDelta);
        for (const o of effect.restore) game.restoreOwnedCard(o);
        for (const a of effect.acquire) game.addOwnedCard(a.cardId, a.serial);
      };

      return {
        seeded: false,
        lastRefresh: 0,
        listings: [],
        offers: [],
        priceHistory: {},
        transactions: [],
        purchases: [],
        sales: [],

        ensureSeeded: () => {
          if (get().seeded) return;
          const now = Date.now();
          const rng = rngFrom(seedFrom("drl-market-seed"));
          const bots = generateBotListings(TARGET_BOT_LISTINGS, now, rng).map((l) => ({ ...l, sellerId: "bot", status: "active" as const }));
          set({ seeded: true, priceHistory: seedPriceHistory(now, rng), listings: bots, lastRefresh: now });
        },

        refreshMarket: () => {
          const now = Date.now();
          const s = get();
          const eng = engine();
          eng.expireListings(now);
          const settle = eng.settle(now, seedFrom(`market-settle|${s.lastRefresh}|${s.listings.length}`));
          applyEffect(settle.effect);
          const soldNow: TxRecord[] = settle.events.filter((e) => e.type === "listing_sold").map((e) => ({ cardId: e.cardId!, price: (e.data as { price: number }).price, at: now }));

          // Rotación de bots determinista + top-up.
          const rng = rngFrom(seedFrom(`market-bots|${now}|${s.listings.length}`));
          const snap = eng.snapshot();
          const active = eng.listings();
          const keptBots = active.filter((l) => l.sellerId !== "user" && rng() > 0.12);
          const users = active.filter((l) => l.sellerId === "user");
          const need = Math.max(0, TARGET_BOT_LISTINGS - keptBots.length);
          const newBots = generateBotListings(need, now, rng).map((l) => ({ ...l, sellerId: "bot", status: "active" as const }));
          set({
            listings: [...users, ...keptBots, ...newBots],
            offers: snap.offers.filter((o) => o.status === "pending" || o.status === "countered"),
            priceHistory: snap.priceHistory,
            transactions: snap.transactions,
            sales: [...soldNow, ...s.sales].slice(0, 60),
            lastRefresh: now,
          });
        },

        buyListing: (id) => {
          const now = Date.now();
          const listing = get().listings.find((l) => l.id === id);
          if (!listing) return { ok: false, error: "El listado ya no está disponible" };
          if (useGameStore.getState().credits < listing.price) return { ok: false, error: "Créditos insuficientes" };
          const eng = engine();
          const res = eng.buyListing(id, "user", now);
          if (!res.ok) return { ok: false, error: res.error };
          applyEffect(res.effect);
          useEventsStore.getState().recordMarket("buy");
          commit(eng);
          set((st) => ({ purchases: [{ cardId: listing.cardId, serial: listing.serial, price: listing.price, at: now }, ...st.purchases].slice(0, 60) }));
          return { ok: true };
        },

        listForSale: (uid, price, opts) => {
          const rounded = Math.round(price);
          if (!Number.isFinite(rounded) || rounded < 25) return { ok: false, error: "El precio mínimo es 25" };
          const game = useGameStore.getState();
          if (game.isLocked(uid)) return { ok: false, error: "No puedes vender una carta bloqueada" };
          const owned = game.removeOwnedCard(uid);
          if (!owned) return { ok: false, error: "Carta no encontrada" };
          const eng = engine();
          const res = eng.createListing({ owned, price: rounded, visibility: opts?.visibility, reservedFor: opts?.reservedFor, expiresAt: opts?.expiresAt }, Date.now());
          if (!res.ok) { game.restoreOwnedCard(owned); return { ok: false, error: res.error }; } // no se pudo listar: se devuelve intacta
          commit(eng);
          useEventsStore.getState().recordMarket("sell");
          return { ok: true };
        },

        updatePrice: (id, price) => {
          const eng = engine();
          const res = eng.updatePrice(id, Math.round(price), Date.now());
          if (!res.ok) return { ok: false, error: res.error };
          commit(eng);
          return { ok: true };
        },

        cancelListing: (id) => {
          const eng = engine();
          const res = eng.cancelListing(id, Date.now());
          if (!res.ok) return;
          applyEffect(res.effect);
          commit(eng);
        },

        placeOffer: (cardId, amount, listingId) => {
          const eng = engine();
          const res = eng.placeOffer({ cardId, amount: Math.round(amount), from: "user", listingId }, Date.now());
          if (!res.ok) return { ok: false, error: res.error };
          commit(eng);
          return { ok: true, offerId: res.events[0]?.offerId };
        },

        acceptOffer: (id) => {
          const now = Date.now();
          const eng = engine();
          const res = eng.acceptOffer(id, now);
          if (!res.ok) return { ok: false, error: res.error };
          applyEffect(res.effect);
          commit(eng);
          if (res.effect.creditsDelta > 0) set((st) => ({ sales: [{ cardId: res.events.find((e) => e.cardId)?.cardId ?? "", price: res.effect.creditsDelta, at: now }, ...st.sales].slice(0, 60) }));
          return { ok: true };
        },

        rejectOffer: (id) => { const eng = engine(); if (eng.rejectOffer(id, Date.now()).ok) commit(eng); },

        counterOffer: (id, amount) => {
          const eng = engine();
          const res = eng.counterOffer(id, Math.round(amount), Date.now());
          if (!res.ok) return { ok: false, error: res.error };
          commit(eng);
          return { ok: true };
        },

        expireMarket: () => {
          const eng = engine();
          const res = eng.expireListings(Date.now());
          applyEffect(res.effect);
          commit(eng);
        },

        analytics: () => engine().analytics(),

        resetMarket: () => set({ seeded: false, listings: [], offers: [], priceHistory: {}, transactions: [], purchases: [], sales: [], lastRefresh: 0 }),
      };
    },
    {
      name: "drl-champions-market",
      version: MARKET_SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ seeded: s.seeded, lastRefresh: s.lastRefresh, listings: s.listings, offers: s.offers, priceHistory: s.priceHistory, transactions: s.transactions, purchases: s.purchases, sales: s.sales }),
      migrate: (persisted: unknown) => {
        const p = (persisted && typeof persisted === "object" ? persisted : {}) as Record<string, unknown>;
        const m = migrateMarketState(p);
        return {
          seeded: !!p.seeded, lastRefresh: typeof p.lastRefresh === "number" ? p.lastRefresh : 0,
          listings: m.listings, offers: m.offers, priceHistory: m.priceHistory, transactions: m.transactions,
          purchases: Array.isArray(p.purchases) ? (p.purchases as TxRecord[]) : [],
          sales: Array.isArray(p.sales) ? (p.sales as TxRecord[]) : [],
        } as Partial<MarketState>;
      },
    },
  ),
);
