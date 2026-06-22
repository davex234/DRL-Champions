"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { MarketListing, PriceRecord, TxRecord } from "@/domain/market/types";
import { emptyRecord, pushSale } from "@/domain/market/history";
import { instanceValue } from "@/domain/economy/pricing";
import { getCard } from "@/data/catalog";
import {
  seedPriceHistory,
  generateBotListings,
  makeListingId,
} from "@/data/marketSeed";
import { useGameStore } from "./useGameStore";
import { useEventsStore } from "./useEventsStore";

const TARGET_BOT_LISTINGS = 54;

interface MarketState {
  seeded: boolean;
  listings: MarketListing[];
  priceHistory: Record<string, PriceRecord>;
  purchases: TxRecord[];
  sales: TxRecord[];
  lastRefresh: number;

  ensureSeeded: () => void;
  refreshMarket: () => void;
  buyListing: (id: string) => { ok: boolean; error?: string };
  listForSale: (uid: string, price: number) => { ok: boolean; error?: string };
  cancelListing: (id: string) => void;
  resetMarket: () => void;
}

function recordOf(history: Record<string, PriceRecord>, cardId: string, fallback: number): PriceRecord {
  return history[cardId] ?? emptyRecord(fallback);
}

export const useMarketStore = create<MarketState>()(
  persist(
    (set, get) => ({
      seeded: false,
      listings: [],
      priceHistory: {},
      purchases: [],
      sales: [],
      lastRefresh: 0,

      ensureSeeded: () => {
        if (get().seeded) return;
        const now = Date.now();
        set({
          seeded: true,
          priceHistory: seedPriceHistory(now),
          listings: generateBotListings(TARGET_BOT_LISTINGS, now),
          lastRefresh: now,
        });
      },

      refreshMarket: () => {
        const now = Date.now();
        const state = get();
        const game = useGameStore.getState();
        const history = { ...state.priceHistory };
        const sales = [...state.sales];
        let creditsGained = 0;
        const kept: MarketListing[] = [];

        for (const l of state.listings) {
          if (l.seller === "user") {
            // Probabilidad de venta: más barato respecto al valor justo => vende antes.
            const def = getCard(l.cardId);
            const fair = def ? instanceValue(def, l.serial) : l.price;
            const ratio = l.price / Math.max(1, fair);
            const chance = Math.min(0.85, Math.max(0.05, 0.5 - (ratio - 1) * 0.9));
            if (Math.random() < chance) {
              creditsGained += l.price;
              sales.unshift({ cardId: l.cardId, serial: l.serial, price: l.price, at: now });
              history[l.cardId] = pushSale(recordOf(history, l.cardId, l.price), l.price, now);
              continue; // vendida -> se retira del mercado
            }
            kept.push(l);
          } else {
            // Rotación de bots: se retira ~12% (simula compras de terceros).
            if (Math.random() > 0.12) kept.push(l);
          }
        }

        const botCount = kept.filter((l) => l.seller === "bot").length;
        const newBots = generateBotListings(Math.max(0, TARGET_BOT_LISTINGS - botCount), now);

        set({
          listings: [...kept, ...newBots],
          priceHistory: history,
          sales: sales.slice(0, 60),
          lastRefresh: now,
        });
        if (creditsGained > 0) game.addCredits(creditsGained);
      },

      buyListing: (id) => {
        const listing = get().listings.find((l) => l.id === id);
        if (!listing) return { ok: false, error: "El listado ya no está disponible" };
        if (listing.seller === "user")
          return { ok: false, error: "No puedes comprar tu propio listado" };

        const game = useGameStore.getState();
        if (!game.spendCredits(listing.price))
          return { ok: false, error: "Créditos insuficientes" };
        game.addOwnedCard(listing.cardId, listing.serial);
        useEventsStore.getState().recordMarket("buy");

        const now = Date.now();
        set((s) => ({
          listings: s.listings.filter((l) => l.id !== id),
          purchases: [
            { cardId: listing.cardId, serial: listing.serial, price: listing.price, at: now },
            ...s.purchases,
          ].slice(0, 60),
          priceHistory: {
            ...s.priceHistory,
            [listing.cardId]: pushSale(
              recordOf(s.priceHistory, listing.cardId, listing.price),
              listing.price,
              now,
            ),
          },
        }));
        return { ok: true };
      },

      listForSale: (uid, price) => {
        const rounded = Math.round(price);
        if (!rounded || rounded < 25) return { ok: false, error: "El precio mínimo es 25" };
        const game = useGameStore.getState();
        const removed = game.removeOwnedCard(uid);
        if (!removed) return { ok: false, error: "Carta no encontrada" };
        const listing: MarketListing = {
          id: makeListingId("user", Math.random),
          cardId: removed.cardId,
          serial: removed.serial,
          price: rounded,
          seller: "user",
          listedAt: Date.now(),
        };
        set((s) => ({ listings: [listing, ...s.listings] }));
        useEventsStore.getState().recordMarket("sell");
        return { ok: true };
      },

      cancelListing: (id) => {
        const listing = get().listings.find((l) => l.id === id && l.seller === "user");
        if (!listing) return;
        useGameStore.getState().addOwnedCard(listing.cardId, listing.serial);
        set((s) => ({ listings: s.listings.filter((l) => l.id !== id) }));
      },

      resetMarket: () =>
        set({ seeded: false, listings: [], priceHistory: {}, purchases: [], sales: [], lastRefresh: 0 }),
    }),
    {
      name: "drl-champions-market",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
