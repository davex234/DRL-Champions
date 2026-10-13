"use client";

/**
 * BATTLE PASS STORE — el boundary del Pass Engine (Collection Fase 6/7).
 *
 * Persiste el `PassState`, RECOGE un `MetricSnapshot` con datos REALES de los stores existentes
 * (useGameStore/useMarketStore — Gameplay/Collection/Marketplace/Craft) SIN duplicar estadísticas, y
 * APLICA las recompensas del motor por la ÚNICA ruta (`applyReward` → PackEngine/Minter/economía). El
 * motor es puro/determinista; aquí entran el reloj y la semilla. Aditivo: no toca `useEventsStore`.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { PassEngine, freshPassState, migratePassState, BP_SCHEMA_VERSION, type PassState, type MetricSnapshot, type Reward, type PassAnalytics } from "@/battlepass";
import { LEGACY_LOCAL_SEASON as LEGACY_LOCAL_SEASON, getSeason } from "@/data/seasons";
import { makeRng, seedFrom } from "@/sim/rng";
import { dayKey, weekId } from "@/domain/events/time";
import { applyReward } from "@/lib/rewards";
import { getCard, CARDS } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
import { useGameStore } from "./useGameStore";
import { useMarketStore } from "./useMarketStore";

const rngFrom = (seed: number) => makeRng(seed);

/** Reúne métricas REALES del ecosistema (contadores acumulados). No duplica: solo lee. */
export function gatherSnapshot(): MetricSnapshot {
  const g = useGameStore.getState();
  const m = useMarketStore.getState();
  const distinct = new Set(g.ownedCards.map((o) => o.cardId)).size;
  let legendary = 0;
  for (const o of g.ownedCards) { const c = getCard(o.cardId); if (c && bucketForRank(getVariant(c.variantId).rank) === "legendary") legendary++; }
  return {
    packs_opened: g.packsOpened,
    matches_played: g.record.played,
    matches_won: g.record.won,
    cards_owned: g.ownedCards.length,
    cards_crafted: g.craftedCount,
    collection_completion: CARDS.length ? Math.round((distinct / CARDS.length) * 100) : 0,
    legendary_owned: legendary,
    market_buy: m.purchases.length,
    market_sell: m.sales.length,
    ranked_wins: 0,
  };
}

interface BPState {
  pass: PassState;
  seasonStart: number;
  dailyKey: string;
  weeklyKey: string;

  ensureSeason: () => void;
  gainXp: (amount: number) => void;
  claimReward: (level: number, track: "free" | "premium") => { ok: boolean; error?: string };
  claimTrack: (track: "free" | "premium") => void;
  unlockPremium: () => { ok: boolean; error?: string };
  completeMission: (id: string) => { ok: boolean; error?: string };
  claimReadyMissions: () => number;
  refreshDaily: () => void;
  refreshWeekly: () => void;
  setAutoClaim: (on: boolean) => void;
  advanceSeason: (nextSeasonId: string) => void;
  analytics: () => PassAnalytics;
  resetPass: () => void;
}

export const useBattlePassStore = create<BPState>()(
  persist(
    (set, get) => {
      const seasonOf = (id: string) => getSeason(id) ?? LEGACY_LOCAL_SEASON;
      const eng = (): PassEngine => new PassEngine(get().pass, seasonOf(get().pass.seasonId));
      const apply = (rewards: Reward[]): void => { for (const r of rewards) applyReward(r); };
      const commit = (e: PassEngine, rewards: Reward[]): void => { apply(rewards); set({ pass: e.snapshot() }); };

      return {
        pass: freshPassState(LEGACY_LOCAL_SEASON.id),
        seasonStart: 0,
        dailyKey: "",
        weeklyKey: "",

        ensureSeason: () => {
          const s = get();
          const now = Date.now();
          if (s.seasonStart === 0) set({ seasonStart: now, pass: s.pass.seasonId ? s.pass : freshPassState(LEGACY_LOCAL_SEASON.id) });
          get().refreshDaily();
          get().refreshWeekly();
        },

        gainXp: (amount) => { const e = eng(); const r = e.gainXp(amount, Date.now()); commit(e, r.rewards); },

        claimReward: (level, track) => {
          const e = eng();
          const r = e.claimReward(level, track, Date.now());
          if (!r.ok) return { ok: false, error: r.error };
          commit(e, r.rewards);
          return { ok: true };
        },

        claimTrack: (track) => { const e = eng(); const r = e.claimTrack(track, Date.now()); commit(e, r.rewards); },

        /*
         * Abrir el carril premium. Hasta la F18.2 se pagaba con FICHAS DE EVENTO, la
         * segunda moneda que se ha retirado. Ahora solo hay un precio posible: DRL
         * Credits, y solo si la temporada define uno mayor que cero.
         *
         * El `return` de la temporada sin precio es deliberado. Al quitar las fichas,
         * `premiumCost` se quedó vacío en las dos temporadas, y un coste ausente leído
         * como «cuesta 0» habría REGALADO el carril de pago a todo el mundo. Sin precio
         * no hay compra.
         */
        unlockPremium: () => {
          const s = get();
          if (s.pass.premium) return { ok: false, error: "Premium ya desbloqueado" };
          const cost = seasonOf(s.pass.seasonId).premiumCost ?? {};
          const price = cost.credits ?? 0;
          if (price <= 0) return { ok: false, error: "El pase de esta temporada no está a la venta" };
          const game = useGameStore.getState();
          if (price > game.credits) return { ok: false, error: "DRL Credits insuficientes" };
          game.spendCredits(price);
          const e = eng();
          const r = e.unlockPremium(Date.now());
          commit(e, r.rewards);
          return { ok: true };
        },

        completeMission: (id) => {
          const e = eng();
          const r = e.completeMission(id, gatherSnapshot(), Date.now());
          if (!r.ok) return { ok: false, error: r.error };
          commit(e, r.rewards);
          return { ok: true };
        },

        claimReadyMissions: () => {
          const snap = gatherSnapshot();
          const now = Date.now();
          const e = eng();
          const rewards: Reward[] = [];
          let n = 0;
          for (const m of e.snapshot().missions) {
            const res = e.completeMission(m.id, snap, now);
            if (res.ok) { rewards.push(...res.rewards); n++; }
          }
          commit(e, rewards);
          return n;
        },

        refreshDaily: () => {
          const now = Date.now();
          const s = get();
          const key = dayKey(now);
          if (s.dailyKey === key) return;
          const e = eng();
          e.refreshMissions("daily", 3, gatherSnapshot(), rngFrom(seedFrom(`daily|${key}`)), now);
          set({ pass: e.snapshot(), dailyKey: key });
        },

        refreshWeekly: () => {
          const now = Date.now();
          const s = get();
          const key = weekId(now, s.seasonStart || now);
          if (s.weeklyKey === key) return;
          const e = eng();
          e.refreshMissions("weekly", 3, gatherSnapshot(), rngFrom(seedFrom(`weekly|${key}`)), now);
          set({ pass: e.snapshot(), weeklyKey: key });
        },

        setAutoClaim: (on) => { const e = eng(); e.setAutoClaim(on); set({ pass: e.snapshot() }); },

        advanceSeason: (nextSeasonId) => { const e = eng(); const r = e.advanceSeason(nextSeasonId, Date.now()); set({ pass: r.state, dailyKey: "", weeklyKey: "" }); },

        analytics: () => eng().analytics(),

        resetPass: () => set({ pass: freshPassState(LEGACY_LOCAL_SEASON.id), seasonStart: Date.now(), dailyKey: "", weeklyKey: "" }),
      };
    },
    {
      name: "drl-champions-battlepass",
      version: BP_SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ pass: s.pass, seasonStart: s.seasonStart, dailyKey: s.dailyKey, weeklyKey: s.weeklyKey }),
      migrate: (persisted: unknown) => {
        const p = (persisted && typeof persisted === "object" ? persisted : {}) as Record<string, unknown>;
        return {
          pass: migratePassState(p.pass, LEGACY_LOCAL_SEASON.id),
          seasonStart: typeof p.seasonStart === "number" ? p.seasonStart : 0,
          dailyKey: typeof p.dailyKey === "string" ? p.dailyKey : "",
          weeklyKey: typeof p.weeklyKey === "string" ? p.weeklyKey : "",
        } as Partial<BPState>;
      },
    },
  ),
);

