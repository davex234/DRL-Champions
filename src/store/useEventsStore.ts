"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { MissionMetric, NotificationItem, Reward } from "@/domain/events/types";
import { EVENTS, eventMissions, getEvent, weeklyTasks } from "@/data/events";
import { eventWindow, weekId, dayKey, dayDiff } from "@/domain/events/time";
import { passProgress, passRewardForLevel } from "@/domain/events/pass";
import { dailyReward } from "@/domain/events/daily";
import { isEpicOrBetterCard, isEventEdition, isLegendaryCard } from "@/domain/events/editions";
import { useGameStore } from "./useGameStore";
import type { OpenedResult } from "./useGameStore";
import { ns, td } from "@/i18n/runtime";

const tr = ns("store");

type MetricMap = Partial<Record<MissionMetric, number>>;

interface EventsState {
  seasonStart: number;
  progress: Record<string, MetricMap>; // eventId -> métricas
  weeklyProgress: Record<string, MetricMap>; // weekId -> métricas
  claimedMissions: string[]; // `${eventId}:${missionId}`
  claimedWeekly: string[]; // `${weekId}:${taskId}`
  passXp: Record<string, number>;
  claimedPassLevels: Record<string, number[]>;
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
function grantReward(reward: Reward) {
  const game = useGameStore.getState();
  if (reward.credits) game.addCredits(reward.credits);
  if (reward.xp) game.addXp(reward.xp);
  if (reward.packId) game.grantPack(reward.packId, reward.packCount ?? 1);
  if (reward.cardId) game.grantCard(reward.cardId);
}

export const useEventsStore = create<EventsState>()(
  persist(
    (set, get) => {
      const notify = (n: Omit<NotificationItem, "id" | "at" | "read">) =>
        set((s) => ({
          notifications: [
            { ...n, id: notifId(), at: Date.now(), read: false },
            ...s.notifications,
          ].slice(0, 40),
        }));

      return {
        seasonStart: 0,
        progress: {},
        weeklyProgress: {},
        claimedMissions: [],
        claimedWeekly: [],
        passXp: {},
        claimedPassLevels: {},
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
                add({ kind: "event_start", title: tr("Evento activo: {name}", { name: ev.name }), message: ev.subtitle });
              else if (w.status === "ended" && prev === "active")
                add({ kind: "event_end", title: `${ev.name} ha finalizado`, message: tr("Sus sobres ya no están disponibles.") });
              seen[ev.id] = w.status;
            }
            if (w.status !== "active") continue;
            for (const m of eventMissions(ev)) {
              const key = `${ev.id}:${m.id}`;
              const prog = s.progress[ev.id]?.[m.metric] ?? 0;
              if (prog >= m.goal && !s.claimedMissions.includes(key) && !notifiedM.includes(key)) {
                add({ kind: "mission", title: tr("Misión lista"), message: tr("{label} — reclama tu recompensa", { label: td(m.label) }) });
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
            const wid = weekId(now, s.seasonStart);

            // Catálogo diseñado: «legendaria» y «épica o superior» sustituyen a MVP y Winner (ver `events/editions`).
            let legendary = 0;
            let epic = 0;
            for (const r of results) {
              if (isLegendaryCard(r.card.variantId)) legendary++;
              if (isEpicOrBetterCard(r.card.variantId)) epic++;
            }

            for (const ev of EVENTS) {
              if (eventWindow(ev, s.seasonStart, now).status !== "active") continue;
              progress = bump(progress, ev.id, "open_packs", 1);
              if (ev.packIds.includes(packId)) {
                progress = bump(progress, ev.id, "open_event_packs", 1);
              }
              if (legendary) progress = bump(progress, ev.id, "get_legendary", legendary);
              if (epic) progress = bump(progress, ev.id, "get_epic", epic);
              const evCards = results.filter((r) => isEventEdition(ev.type, r.card.variantId)).length;
              if (evCards) progress = bump(progress, ev.id, "get_event_card", evCards);
            }

            weekly = bump(weekly, wid, "open_packs", 1);
            if (legendary) weekly = bump(weekly, wid, "get_legendary", legendary);
            if (epic) weekly = bump(weekly, wid, "get_epic", epic);

            return { progress, weeklyProgress: weekly };
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
          const mission = ev ? eventMissions(ev).find((m) => m.id === missionId) : undefined;
          if (!ev || !mission) return;
          const s = get();
          const key = `${eventId}:${missionId}`;
          if (s.claimedMissions.includes(key)) return;
          if ((s.progress[eventId]?.[mission.metric] ?? 0) < mission.goal) return;
          grantReward(mission.reward);
          set((st) => ({
            claimedMissions: [...st.claimedMissions, key],
            passXp: { ...st.passXp, [eventId]: (st.passXp[eventId] ?? 0) + mission.passXp },
          }));
          notify({ kind: "reward", title: tr("Misión completada"), message: tr("{label} · +recompensa", { label: td(mission.label) }) });
        },

        claimWeekly: (taskId) => {
          const now = Date.now();
          const s = get();
          const wid = weekId(now, s.seasonStart);
          const task = weeklyTasks().find((t) => t.id === taskId);
          if (!task) return;
          const key = `${wid}:${taskId}`;
          if (s.claimedWeekly.includes(key)) return;
          if ((s.weeklyProgress[wid]?.[task.metric] ?? 0) < task.goal) return;
          grantReward(task.reward);
          set((st) => ({ claimedWeekly: [...st.claimedWeekly, key] }));
          notify({ kind: "reward", title: tr("Tarea semanal completada"), message: task.label });
        },

        claimPassLevel: (eventId, level) => {
          const ev = getEvent(eventId);
          if (!ev) return;
          const s = get();
          const reached = passProgress(s.passXp[eventId] ?? 0, ev).level;
          if (level < 1 || level > reached) return;
          const claimed = s.claimedPassLevels[eventId] ?? [];
          if (claimed.includes(level)) return;
          grantReward(passRewardForLevel(ev, level));
          set((st) => ({
            claimedPassLevels: {
              ...st.claimedPassLevels,
              [eventId]: [...(st.claimedPassLevels[eventId] ?? []), level],
            },
          }));
          notify({ kind: "reward", title: tr("Pase nivel {level}", { level }), message: tr("Recompensa del pase reclamada") });
        },

        claimDaily: () => {
          const now = Date.now();
          const s = get();
          if (s.daily.lastClaimTs != null) {
            const diff = dayDiff(now, s.daily.lastClaimTs);
            if (diff === 0) return { ok: false, error: tr("Ya has reclamado hoy") };
            const streak = diff === 1 ? s.daily.streak + 1 : 1;
            const reward = dailyReward(streak);
            grantReward(reward);
            set({ daily: { streak, lastClaimTs: now } });
            notify({ kind: "daily", title: tr("Recompensa diaria · Día {streak}", { streak }), message: tr("¡Vuelve mañana para más!") });
            return { ok: true, reward, streak };
          }
          const reward = dailyReward(1);
          grantReward(reward);
          set({ daily: { streak: 1, lastClaimTs: now } });
          notify({ kind: "daily", title: tr("Recompensa diaria · Día 1"), message: tr("¡Vuelve mañana para más!") });
          return { ok: true, reward, streak: 1 };
        },

        markAllRead: () =>
          set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),

        resetEvents: () =>
          set({
            seasonStart: Date.now(),
            progress: {},
            weeklyProgress: {},
            claimedMissions: [],
            claimedWeekly: [],
            passXp: {},
            claimedPassLevels: {},
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
      // Red de seguridad para futuros bumps: preserva el estado persistido (zustand hace merge sobre
      // los defaults, así que campos nuevos toman su valor inicial). Sin esto, un bump de versión sin
      // migrate DESCARTA el progreso del usuario (misiones/pases/rachas).
      migrate: (persisted) => (persisted && typeof persisted === "object" ? (persisted as Partial<EventsState>) : {}),
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
    for (const m of eventMissions(ev)) {
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
  for (const t of weeklyTasks()) {
    const key = `${wid}:${t.id}`;
    if ((state.weeklyProgress[wid]?.[t.metric] ?? 0) >= t.goal && !state.claimedWeekly.includes(key)) count++;
  }
  return count;
}

export { dayKey };
