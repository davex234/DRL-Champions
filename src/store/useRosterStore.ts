"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Player } from "@/domain/cards/types";
import { statsFromMetrics } from "@/domain/cards/statsFromMetrics";
import { PLAYERS } from "@/data/players";
import { rebuildCatalog } from "@/data/catalog";

interface RosterState {
  /** Jugadores añadidos/importados desde el panel de administración. */
  customPlayers: Player[];
  /** Ediciones (parciales) sobre jugadores semilla o importados, por id. */
  overrides: Record<string, Partial<Player>>;
  /** Ids ocultados/eliminados. */
  removed: string[];
  /** Se incrementa en cada cambio para forzar recomputaciones en la UI. */
  version: number;

  sync: () => void;
  addPlayers: (players: Player[]) => void;
  upsertWithAccolades: (player: Player, accolades: string[]) => void;
  updatePlayer: (id: string, patch: Partial<Player>) => void;
  deletePlayer: (id: string) => void;
  restorePlayer: (id: string) => void;
  regenerateStats: (id: string) => void;
  resetRoster: () => void;
}

const applyOverride = (p: Player, o?: Partial<Player>): Player => (o ? { ...p, ...o } : p);

/** Roster efectivo: semilla (sin eliminados, con ediciones) + importados. */
export function effectiveRoster(s: Pick<RosterState, "customPlayers" | "overrides" | "removed">): Player[] {
  const removed = new Set(s.removed);
  const map = new Map<string, Player>();
  for (const p of PLAYERS) if (!removed.has(p.id)) map.set(p.id, applyOverride(p, s.overrides[p.id]));
  for (const p of s.customPlayers) if (!removed.has(p.id)) map.set(p.id, applyOverride(p, s.overrides[p.id]));
  return [...map.values()];
}

export function isSeedPlayer(id: string): boolean {
  return PLAYERS.some((p) => p.id === id);
}

const jitter = (n: number) => Math.max(1, Math.min(99, n + Math.round((Math.random() * 2 - 1) * 2)));

export const useRosterStore = create<RosterState>()(
  persist(
    (set, get) => ({
      customPlayers: [],
      overrides: {},
      removed: [],
      version: 0,

      sync: () => {
        rebuildCatalog(effectiveRoster(get()));
        set((s) => ({ version: s.version + 1 }));
      },

      addPlayers: (players) => {
        const ids = new Set(players.map((p) => p.id));
        set((s) => {
          const byId = new Map(s.customPlayers.map((p) => [p.id, p]));
          for (const p of players) byId.set(p.id, p);
          const overrides = { ...s.overrides };
          for (const id of ids) delete overrides[id]; // el guardado define las stats
          return {
            customPlayers: [...byId.values()],
            overrides,
            removed: s.removed.filter((id) => !ids.has(id)),
          };
        });
        get().sync();
      },

      upsertWithAccolades: (player, accolades) => {
        const existing = effectiveRoster(get()).find((p) => p.id === player.id);
        const merged = new Set<string>([...(existing?.accolades ?? []), ...(player.accolades ?? []), ...accolades]);
        get().addPlayers([{ ...(existing ?? player), ...player, accolades: [...merged] as Player["accolades"] }]);
      },

      updatePlayer: (id, patch) => {
        set((s) => ({ overrides: { ...s.overrides, [id]: { ...s.overrides[id], ...patch } } }));
        get().sync();
      },

      deletePlayer: (id) => {
        set((s) => ({ removed: s.removed.includes(id) ? s.removed : [...s.removed, id] }));
        get().sync();
      },

      restorePlayer: (id) => {
        set((s) => ({ removed: s.removed.filter((x) => x !== id) }));
        get().sync();
      },

      regenerateStats: (id) => {
        const eff = effectiveRoster(get()).find((p) => p.id === id);
        if (!eff) return;
        const stats = eff.metrics
          ? statsFromMetrics(eff.metrics)
          : {
              dmg: jitter(eff.stats.dmg),
              scr: jitter(eff.stats.scr),
              com: jitter(eff.stats.com),
              hs: jitter(eff.stats.hs),
              ast: jitter(eff.stats.ast),
              clu: jitter(eff.stats.clu),
            };
        get().updatePlayer(id, { stats });
      },

      resetRoster: () => {
        set({ customPlayers: [], overrides: {}, removed: [], version: 0 });
        get().sync();
      },
    }),
    {
      name: "drl-champions-roster",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        customPlayers: s.customPlayers,
        overrides: s.overrides,
        removed: s.removed,
        version: s.version,
      }),
    },
  ),
);
