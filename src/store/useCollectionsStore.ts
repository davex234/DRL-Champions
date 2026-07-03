"use client";

/**
 * Estado del Collection Engine: qué colecciones/logros se han RECLAMADO.
 *
 * El progreso se calcula al vuelo desde `useGameStore.ownedCards`; aquí solo
 * persistimos los claims (anti-doble-claim, patrón de `useEventsStore`). La
 * recompensa se aplica con el helper compartido `applyReward`.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Reward } from "@/domain/events/types";
import { applyReward } from "@/lib/rewards";

interface CollectionsState {
  hydrated: boolean;
  claimed: string[];
  isClaimed: (id: string) => boolean;
  /** Concede la recompensa una sola vez. Devuelve true si se concedió ahora. */
  claim: (id: string, reward: Reward) => boolean;
  reset: () => void;
}

export const useCollectionsStore = create<CollectionsState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      claimed: [],
      isClaimed: (id) => get().claimed.includes(id),
      claim: (id, reward) => {
        if (get().claimed.includes(id)) return false;
        applyReward(reward);
        set((s) => ({ claimed: [...s.claimed, id] }));
        return true;
      },
      reset: () => set({ claimed: [] }),
    }),
    {
      name: "drl-champions-collections",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ claimed: s.claimed }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);
