"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CardDef, OwnedCard } from "@/domain/cards/types";
import { getVariant } from "@/domain/cards/variants";
import { getCard } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { openPack } from "@/domain/packs/openPack";
import { quickSellValue, instanceValue } from "@/domain/economy/pricing";
import { xpForCardRank } from "@/domain/progression/levels";
import { ACHIEVEMENTS, type AchievementContext } from "@/domain/progression/achievements";

/** Resultado de revelar una carta al abrir un sobre. */
export interface OpenedResult {
  uid: string;
  card: CardDef;
  serial?: number;
  /** Si es la primera copia de esta carta que obtiene el usuario. */
  isNew: boolean;
  value: number;
}

interface GameState {
  hydrated: boolean;
  credits: number;
  xp: number;
  ownedCards: OwnedCard[];
  /** Sobres sin abrir en el inventario. packId -> cantidad. */
  unopenedPacks: Record<string, number>;
  /** Contador de acuñación por carta serializada (para nº de serie). */
  mintCounts: Record<string, number>;
  packsOpened: number;
  claimedAchievements: string[];
  /** Resultado de la última apertura (transitorio, para la pantalla de reveal). */
  lastOpened: OpenedResult[] | null;

  // --- Acciones ---
  buyPack: (packId: string) => { ok: boolean; error?: string };
  openPackFromInventory: (packId: string) => OpenedResult[] | null;
  buyAndOpen: (packId: string) => OpenedResult[] | null;
  quickSell: (uid: string) => void;
  quickSellMany: (uids: string[]) => void;
  claimAchievement: (id: string) => void;
  addCredits: (amount: number) => void;
  /** Resta créditos si hay saldo suficiente. Devuelve true si se cobró. */
  spendCredits: (amount: number) => boolean;
  /** Añade una carta a la colección (compras de mercado). Devuelve el uid. */
  addOwnedCard: (cardId: string, serial?: number) => string;
  /** Quita una instancia por uid y la devuelve (al poner en venta). */
  removeOwnedCard: (uidToRemove: string) => OwnedCard | null;
  /** Otorga sobres al inventario (recompensas de eventos). */
  grantPack: (packId: string, count?: number) => void;
  /** Suma XP de cuenta (recompensas de eventos/misiones). */
  addXp: (amount: number) => void;
  /** Otorga una carta concreta, acuñando nº de serie si procede. */
  grantCard: (cardId: string) => string | null;
  clearLastOpened: () => void;
  resetGame: () => void;
}

const STARTER_CREDITS = 6000;
const STARTER_PACKS: Record<string, number> = { inicial: 3, estandar: 1 };

function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `c_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      credits: STARTER_CREDITS,
      xp: 0,
      ownedCards: [],
      unopenedPacks: { ...STARTER_PACKS },
      mintCounts: {},
      packsOpened: 0,
      claimedAchievements: [],
      lastOpened: null,

      buyPack: (packId) => {
        const pack = getPack(packId);
        if (!pack) return { ok: false, error: "Sobre no encontrado" };
        const { credits } = get();
        if (credits < pack.price) return { ok: false, error: "Créditos insuficientes" };
        set((s) => ({
          credits: s.credits - pack.price,
          unopenedPacks: {
            ...s.unopenedPacks,
            [packId]: (s.unopenedPacks[packId] ?? 0) + 1,
          },
        }));
        return { ok: true };
      },

      openPackFromInventory: (packId) => {
        const pack = getPack(packId);
        const state = get();
        if (!pack || (state.unopenedPacks[packId] ?? 0) <= 0) return null;

        const draws = openPack(pack);
        const results = mintDraws(draws, state);

        set((s) => {
          const owned = new Set(s.ownedCards.map((o) => o.cardId));
          const newOwned: OwnedCard[] = results.map((r) => ({
            uid: r.uid,
            cardId: r.card.id,
            serial: r.serial,
            obtainedAt: Date.now(),
          }));
          const gainedXp = results.reduce(
            (sum, r) => sum + xpForCardRank(getVariant(r.card.variantId).rank),
            0,
          );
          const nextUnopened = { ...s.unopenedPacks, [packId]: s.unopenedPacks[packId] - 1 };
          // marca isNew según lo que ya había antes de añadir
          for (const r of results) r.isNew = !owned.has(r.card.id);
          return {
            ownedCards: [...s.ownedCards, ...newOwned],
            unopenedPacks: nextUnopened,
            mintCounts: results.reduce(
              (acc, r) => {
                if (r.serial != null) acc[r.card.id] = r.serial;
                return acc;
              },
              { ...s.mintCounts } as Record<string, number>,
            ),
            xp: s.xp + gainedXp,
            packsOpened: s.packsOpened + 1,
            lastOpened: results,
          };
        });
        return results;
      },

      buyAndOpen: (packId) => {
        const res = get().buyPack(packId);
        if (!res.ok) return null;
        return get().openPackFromInventory(packId);
      },

      quickSell: (uidToSell) => {
        const { ownedCards } = get();
        const card = ownedCards.find((o) => o.uid === uidToSell);
        if (!card) return;
        const def = getCard(card.cardId);
        if (!def) return;
        const value = quickSellValue(def, card.serial);
        set((s) => ({
          credits: s.credits + value,
          ownedCards: s.ownedCards.filter((o) => o.uid !== uidToSell),
        }));
      },

      quickSellMany: (uids) => {
        const set_ = new Set(uids);
        const { ownedCards } = get();
        let gained = 0;
        for (const o of ownedCards) {
          if (!set_.has(o.uid)) continue;
          const def = getCard(o.cardId);
          if (def) gained += quickSellValue(def, o.serial);
        }
        set((s) => ({
          credits: s.credits + gained,
          ownedCards: s.ownedCards.filter((o) => !set_.has(o.uid)),
        }));
      },

      claimAchievement: (id) => {
        const def = ACHIEVEMENTS.find((a) => a.id === id);
        if (!def) return;
        const state = get();
        if (state.claimedAchievements.includes(id)) return;
        const ctx = buildAchievementContext(state);
        if (def.progress(ctx) < def.goal) return; // todavía no completado
        set((s) => ({
          credits: s.credits + def.reward,
          claimedAchievements: [...s.claimedAchievements, id],
        }));
      },

      addCredits: (amount) => set((s) => ({ credits: s.credits + amount })),

      spendCredits: (amount) => {
        if (get().credits < amount) return false;
        set((s) => ({ credits: s.credits - amount }));
        return true;
      },

      addOwnedCard: (cardId, serial) => {
        const newUid = uid();
        set((s) => ({
          ownedCards: [
            ...s.ownedCards,
            { uid: newUid, cardId, serial, obtainedAt: Date.now() },
          ],
        }));
        return newUid;
      },

      removeOwnedCard: (uidToRemove) => {
        const card = get().ownedCards.find((o) => o.uid === uidToRemove) ?? null;
        if (card) set((s) => ({ ownedCards: s.ownedCards.filter((o) => o.uid !== uidToRemove) }));
        return card;
      },

      grantPack: (packId, count = 1) =>
        set((s) => ({
          unopenedPacks: {
            ...s.unopenedPacks,
            [packId]: (s.unopenedPacks[packId] ?? 0) + count,
          },
        })),

      addXp: (amount) => set((s) => ({ xp: s.xp + amount })),

      grantCard: (cardId) => {
        const def = getCard(cardId);
        if (!def) return null;
        const variant = getVariant(def.variantId);
        const newUid = uid();
        let serial: number | undefined;
        set((s) => {
          if (variant.serialized && variant.serialLimit) {
            const minted = s.mintCounts[cardId] ?? 0;
            serial = Math.min(minted + 1, variant.serialLimit);
          }
          return {
            ownedCards: [
              ...s.ownedCards,
              { uid: newUid, cardId, serial, obtainedAt: Date.now() },
            ],
            mintCounts:
              serial != null ? { ...s.mintCounts, [cardId]: serial } : s.mintCounts,
          };
        });
        return newUid;
      },

      clearLastOpened: () => set({ lastOpened: null }),

      resetGame: () =>
        set({
          credits: STARTER_CREDITS,
          xp: 0,
          ownedCards: [],
          unopenedPacks: { ...STARTER_PACKS },
          mintCounts: {},
          packsOpened: 0,
          claimedAchievements: [],
          lastOpened: null,
        }),
    }),
    {
      name: "drl-champions",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        credits: s.credits,
        xp: s.xp,
        ownedCards: s.ownedCards,
        unopenedPacks: s.unopenedPacks,
        mintCounts: s.mintCounts,
        packsOpened: s.packsOpened,
        claimedAchievements: s.claimedAchievements,
      }),
    },
  ),
);

/** Asigna nº de serie y valor a cada carta del sorteo (sin mutar el store). */
function mintDraws(draws: CardDef[], state: GameState): OpenedResult[] {
  const localMint: Record<string, number> = { ...state.mintCounts };
  return draws.map((card) => {
    const variant = getVariant(card.variantId);
    let serial: number | undefined;
    if (variant.serialized && variant.serialLimit) {
      const minted = localMint[card.id] ?? 0;
      serial = Math.min(minted + 1, variant.serialLimit);
      localMint[card.id] = serial;
    }
    return {
      uid: uid(),
      card,
      serial,
      isNew: false, // se recalcula en set()
      value: instanceValue(card, serial),
    };
  });
}

export function buildAchievementContext(state: GameState): AchievementContext {
  return {
    packsOpened: state.packsOpened,
    ownedCardIds: new Set(state.ownedCards.map((o) => o.cardId)),
  };
}
