"use client";

/**
 * NEWS FEED — noticias in-game generadas automáticamente (cartas nuevas, MVPs,
 * ediciones especiales). Persistente. Lo alimenta el DRL Data Engine vía la capa Intel;
 * la UI (página /noticias + insignia) solo muestra. No es un motor: es un buzón.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { NewsItem } from "@/intel";

interface NewsState {
  items: NewsItem[];
  /** Último tick en que el usuario vio el feed (para el contador de no leídas). */
  seenAt: number;
  add: (items: NewsItem[]) => void;
  markSeen: () => void;
  clear: () => void;
}

export const useNewsStore = create<NewsState>()(
  persist(
    (set) => ({
      items: [],
      seenAt: 0,
      add: (incoming) =>
        set((s) => {
          const known = new Set(s.items.map((i) => i.id));
          const fresh = incoming.filter((i) => !known.has(i.id));
          if (fresh.length === 0) return s;
          return { items: [...fresh, ...s.items].slice(0, 200) };
        }),
      markSeen: () => set({ seenAt: Date.now() }),
      clear: () => set({ items: [], seenAt: Date.now() }),
    }),
    { name: "drl-champions-news", storage: createJSONStorage(() => localStorage) },
  ),
);

/** Nº de noticias no leídas (para la insignia del menú). */
export const unreadCount = (s: NewsState): number => s.items.filter((i) => i.at > s.seenAt).length;
