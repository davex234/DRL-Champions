"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { MissionMetric, NotificationItem, Reward } from "@/domain/events/types";
import { EVENTS, WEEKLY_TASKS, getEvent } from "@/data/events";
import { eventWindow, weekId, dayKey, dayDiff } from "@/domain/events/time";
import { passProgress, passRewardForLevel } from "@/domain/events/pass";
import { dailyReward } from "@/domain/events/daily";
import { getVariant } from "@/domain/cards/variants";
import { useGameStore } from "./useGameStore";
import type { OpenedResult } from "./useGameStore";

type MetricMap = Partial<Record<MissionMetric, number>>;

interface EventsState {
  seasonStart: number;
  tokens: number;
  progress: Record<string, MetricMap>; // eventId -> métricas
  weeklyProgress: Record<string, MetricMap>; // weekId -> métricas
  claimedMissions: string[]; // `${eventId}:${missionId}`
  claimedWeekly: string[]; // `${weekId}:${taskId}`
  passXp: Record<string, number>;
  claimedPassLevels: Record<string, number[]>;
  shopPurchases: Record<string, number>; // `${eventId}:${itemId}` -> nº compras
  cosmetics: string[];
  daily: { streak: number; lastClaimTs: number | null };
  seenStatus: Record<string, string>;
  notifiedMissions: string[];
  notifications: NotificationItem[];

  ensureSeason: () => void;
  refresh: () => void;
  recordPackOpened: (packId: string, results: OpenedResult[]) => void;
  recordMarket: (kind: "buy" | "sell") => void;
  claimMission: (eventId: string, missionId: string) => void;
  claimWeekly: (taskId: string) => void;
  claimPassLevel: (eventId: string, level: number) => void;
  buyShopItem: (eventId: string, itemId: string) => { ok: boolean; error?: string };
  claimDaily: () => { ok: boolean; error?: string; reward?: Reward; streak?: number };
  markAllRead: () => void;
  resetEvents: () => void;
}

let nid = 0;
function notifId(): string {
  nid += 1;
  return `n_${Date.now().toString(36)}_${nid}`;
}

function bump(map: Record<string, MetricMap>, key: string, metric: MissionMetric, amount: number) {
  const cur = map[key] ?? {};
  return { ...map, [key]: { ...cur, [metric]: (cur[metric] ?? 0) + amount } };
}

/** Aplica una recompensa al estado del juego (créditos/xp/sobres/cartas). */
function grantReward(reward: Reward, addTokens: (n: number) => void) {
  const game = useGameStore.getState();
  if (reward.credits) game.addCredits(reward.credits);
  if (reward.xp) game.addXp(reward.xp);
  if (reward.packId) game.grantPack(reward.packId, reward.packCount ?? 1);
  if (reward.cardId) game.grantCard(reward.cardId);
  if (reward.tokens) addTokens(reward.tokens);
}

export const useEventsStore = create<EventsState>()(
  persist(
    (set, get) => {
      const addTokens = (n: number) => set((s) => ({ tokens: s.tokens + n }));
      const notify = (n: Omit<NotificationItem, "id" | "at" | "read">) =>
        set((s) => ({
          notifications: [
            { ...n, id: notifId(), at: Date.now(), read: false },
            ...s.notifications,
          ].slice(0, 40),
        }));

      return {
        seasonStart: 0,
        tokens: 0,
        progress: {},
        weeklyProgress: {},
        claimedMissions: [],
        claimedWeekly: [],
        passXp: {},
        claimedPassLevels: {},
        shopPurchases: {},
        cosmetics: [],
        daily: { streak: 0, lastClaimTs: null },
        seenStatus: {},
        notifiedMissions: [],
        notifications: [],

        ensureSeason: () => {
          if (get().seasonStart === 0) set({ seasonStart: Date.now() });
        },

        refresh: () => {
          if (get().seasonStart === 0) set({ seasonStart: Date.now() });
          const now = Date.now();
          const s = get();
          const seen = { ...s.seenStatus };
          const notifiedM = [...s.notifiedMissions];
          const newNotes: NotificationItem[] = [];
          const add = (n: Omit<NotificationItem, "id" | "at" | "read">) =>
            newNotes.push({ ...n, id: notifId(), at: now, read: false });

          for (const ev of EVENTS) {
            const w = eventWindow(ev, s.seasonStart, now);
            const prev = seen[ev.id];
            if (prev !== w.status) {
              if (w.status === "active")
                add({ kind: "event_start", title: `Evento activo: ${ev.name}`, message: ev.subtitle });
              else if (w.status === "ended" && prev === "active")
                add({ kind: "event_end", title: `${ev.name} ha finalizado`, message: "Sus sobres ya no están disponibles." });
              seen[ev.id] = w.status;
            }
            if (w.status !== "active") continue;
            for (const m of ev.missions) {
              const key = `${ev.id}:${m.id}`;
              const prog = s.progress[ev.id]?.[m.metric] ?? 0;
              if (prog >= m.goal && !s.claimedMissions.includes(key) && !notifiedM.includes(key)) {
                add({ kind: "mission", title: "Misión lista", message: `${m.label} — reclama tu recompensa` });
                notifiedM.push(key);
              }
            }
          }

          if (newNotes.length) {
            set((st) => ({
              seenStatus: seen,
              notifiedMissions: notifiedM,
              notifications: [...newNotes, ...st.notifications].slice(0, 40),
            }));
          } else {
            set({ seenStatus: seen, notifiedMissions: notifiedM });
          }
        },

        recordPackOpened: (packId, results) => {
          const now = Date.now();
          set((s) => {
            if (s.seasonStart === 0) return s;
            let progress = s.progress;
            let weekly = s.weeklyProgress;
            let tokens = s.tokens + 3; // tokens base por abrir cualquier sobre
            const wid = weekId(now, s.seasonStart);

            let mvp = 0;
            let winner = 0;
            for (const r of results) {
              const v = getVariant(r.card.variantId);
              if (v.group === "mvp" || r.card.variantId.endsWith("-mvp")) mvp++;
              if (v.group === "winner" || r.card.variantId.endsWith("-winner")) winner++;
            }

            for (const ev of EVENTS) {
              if (eventWindow(ev, s.seasonStart, now).status !== "active") continue;
              progress = bump(progress, ev.id, "open_packs", 1);
              if (ev.packIds.includes(packId)) {
                progress = bump(progress, ev.id, "open_event_packs", 1);
                tokens += ev.tokensPerPack;
              }
              if (mvp) progress = bump(progress, ev.id, "get_mvp", mvp);
              if (winner) progress = bump(progress, ev.id, "get_winner", winner);
              const evCards = results.filter((r) => r.card.variantId.startsWith(ev.type)).length;
              if (evCards) progress = bump(progress, ev.id, "get_event_card", evCards);
            }

            weekly = bump(weekly, wid, "open_packs", 1);
            if (mvp) weekly = bump(weekly, wid, "get_mvp", mvp);
            if (winner) weekly = bump(weekly, wid, "get_winner", winner);

            return { progress, weeklyProgress: weekly, tokens };
          });
        },

        recordMarket: (kind) => {
          const metric: MissionMetric = kind === "buy" ? "market_buy" : "market_sell";
          const now = Date.now();
          set((s) => {
            if (s.seasonStart === 0) return s;
            let progress = s.progress;
            for (const ev of EVENTS) {
              if (eventWindow(ev, s.seasonStart, now).status === "active")
                progress = bump(progress, ev.id, metric, 1);
            }
            const weekly = bump(s.weeklyProgress, weekId(now, s.seasonStart), metric, 1);
            return { progress, weeklyProgress: weekly };
          });
        },

        claimMission: (eventId, missionId) => {
          const ev = getEvent(eventId);
          const mission = ev?.missions.find((m) => m.id === missionId);
          if (!ev || !mission) return;
          const s = get();
          const key = `${eventId}:${missionId}`;
          if (s.claimedMissions.includes(key)) return;
          if ((s.progress[eventId]?.[mission.metric] ?? 0) < mission.goal) return;
          grantReward(mission.reward, addTokens);
          set((st) => ({
            claimedMissions: [...st.claimedMissions, key],
            passXp: { ...st.passXp, [eventId]: (st.passXp[eventId] ?? 0) + mission.passXp },
          }));
          notify({ kind: "reward", title: "Misión completada", message: `${mission.label} · +recompensa` });
        },

        claimWeekly: (taskId) => {
          const now = Date.now();
          const s = get();
          const wid = weekId(now, s.seasonStart);
          const task = WEEKLY_TASKS.find((t) => t.id === taskId);
          if (!task) return;
          const key = `${wid}:${taskId}`;
          if (s.claimedWeekly.includes(key)) return;
          if ((s.weeklyProgress[wid]?.[task.metric] ?? 0) < task.goal) return;
          grantReward(task.reward, addTokens);
          set((st) => ({ claimedWeekly: [...st.claimedWeekly, key] }));
          notify({ kind: "reward", title: "Tarea semanal completada", message: task.label });
        },

        claimPassLevel: (eventId, level) => {
          const ev = getEvent(eventId);
          if (!ev) return;
          const s = get();
          const reached = passProgress(s.passXp[eventId] ?? 0, ev).level;
          if (level < 1 || level > reached) return;
          const claimed = s.claimedPassLevels[eventId] ?? [];
          if (claimed.includes(level)) return;
          grantReward(passRewardForLevel(ev, level), addTokens);
          set((st) => ({
            claimedPassLevels: {
              ...st.claimedPassLevels,
              [eventId]: [...(st.claimedPassLevels[eventId] ?? []), level],
            },
          }));
          notify({ kind: "reward", title: `Pase nivel ${level}`, message: "Recompensa del pase reclamada" });
        },

        buyShopItem: (eventId, itemId) => {
          const ev = getEvent(eventId);
          const item = ev?.shop.find((i) => i.id === itemId);
          if (!ev || !item) return { ok: false, error: "Artículo no encontrado" };
          const s = get();
          const key = `${eventId}:${itemId}`;
          const bought = s.shopPurchases[key] ?? 0;
          if (item.stock != null && bought >= item.stock) return { ok: false, error: "Agotado" };
          if (s.tokens < item.cost) return { ok: false, error: "Tokens insuficientes" };
          set((st) => ({
            tokens: st.tokens - item.cost,
            shopPurchases: { ...st.shopPurchases, [key]: bought + 1 },
            cosmetics: item.cosmetic ? [...st.cosmetics, key] : st.cosmetics,
          }));
          grantReward(item.reward, addTokens);
          return { ok: true };
        },

        claimDaily: () => {
          const now = Date.now();
          const s = get();
          if (s.daily.lastClaimTs != null) {
            const diff = dayDiff(now, s.daily.lastClaimTs);
            if (diff === 0) return { ok: false, error: "Ya has reclamado hoy" };
            const streak = diff === 1 ? s.daily.streak + 1 : 1;
            const reward = dailyReward(streak);
            grantReward(reward, addTokens);
            set({ daily: { streak, lastClaimTs: now } });
            notify({ kind: "daily", title: `Recompensa diaria · Día ${streak}`, message: "¡Vuelve mañana para más!" });
            return { ok: true, reward, streak };
          }
          const reward = dailyReward(1);
          grantReward(reward, addTokens);
          set({ daily: { streak: 1, lastClaimTs: now } });
          notify({ kind: "daily", title: "Recompensa diaria · Día 1", message: "¡Vuelve mañana para más!" });
          return { ok: true, reward, streak: 1 };
        },

        markAllRead: () =>
          set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),

        resetEvents: () =>
          set({
            seasonStart: Date.now(),
            tokens: 0,
            progress: {},
            weeklyProgress: {},
            claimedMissions: [],
            claimedWeekly: [],
            passXp: {},
            claimedPassLevels: {},
            shopPurchases: {},
            cosmetics: [],
            daily: { streak: 0, lastClaimTs: null },
            seenStatus: {},
            notifiedMissions: [],
            notifications: [],
          }),
      };
    },
    {
      name: "drl-champions-events",
      storage: createJSONStorage(() => localStorage),
      // dayKey lo usamos para mostrar; el cálculo de racha usa lastClaimTs.
      version: 1,
    },
  ),
);

/** Nº de cosas reclamables ahora (para la insignia de navegación). */
export function claimableCount(state: EventsState, now: number): number {
  if (state.seasonStart === 0) return 0;
  let count = 0;
  // Diaria disponible
  if (state.daily.lastClaimTs == null || dayDiff(now, state.daily.lastClaimTs) >= 1) count++;
  // Misiones de eventos activos
  for (const ev of EVENTS) {
    if (eventWindow(ev, state.seasonStart, now).status !== "active") continue;
    for (const m of ev.missions) {
      const key = `${ev.id}:${m.id}`;
      if ((state.progress[ev.id]?.[m.metric] ?? 0) >= m.goal && !state.claimedMissions.includes(key)) count++;
    }
    // Niveles de pase
    const reached = passProgress(state.passXp[ev.id] ?? 0, ev).level;
    const claimed = state.claimedPassLevels[ev.id] ?? [];
    for (let l = 1; l <= reached; l++) if (!claimed.includes(l)) count++;
  }
  // Tareas semanales
  const wid = weekId(now, state.seasonStart);
  for (const t of WEEKLY_TASKS) {
    const key = `${wid}:${t.id}`;
    if ((state.weeklyProgress[wid]?.[t.metric] ?? 0) >= t.goal && !state.claimedWeekly.includes(key)) count++;
  }
  return count;
}

export { dayKey };
