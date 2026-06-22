"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Tournament, Match, GeneratedCard, EngineLog, EngineNotification, SchedulerJob, Pickem } from "@/engine/types";
import type { EventDef } from "@/domain/events/types";
import { runEngine } from "@/engine/dataEngine";
import { mockSource } from "@/engine/sources/mock";
import { vlrSource, isVlrConfigured } from "@/engine/sources/vlr";
import { dueJobs } from "@/engine/scheduler";
import { dispatchTelegram, isTelegramConfigured, makeNotification } from "@/engine/notifications";
import { useRosterStore } from "./useRosterStore";
import { useGameStore } from "./useGameStore";

const cardKey = (c: { tournamentId: string; kind: string; playerId: string }) => `${c.tournamentId}:${c.kind}:${c.playerId}`;

interface EngineState {
  source: "mock" | "vlr";
  running: boolean;
  lastRun: number | null;
  tournaments: Tournament[];
  matches: Match[];
  generatedCards: GeneratedCard[];
  generatedEvents: EventDef[];
  logs: EngineLog[];
  notifications: EngineNotification[];
  jobs: SchedulerJob[];
  pickems: Record<string, Pickem>;
  processed: string[];

  setSource: (s: "mock" | "vlr") => void;
  run: () => Promise<void>;
  approveCard: (id: string) => void;
  rejectCard: (id: string) => void;
  tick: () => void;
  setPick: (matchId: string, team: string) => void;
  resolvePickems: () => void;
  simulateFinish: (matchId: string, winner: string) => void;
  resetEngine: () => void;
}

/** Materializa una carta en el juego: upsert del jugador con su accolade. */
function applyCard(card: GeneratedCard) {
  useRosterStore.getState().upsertWithAccolades(card.player, [card.accolade]);
}

export const useEngineStore = create<EngineState>()(
  persist(
    (set, get) => ({
      source: "mock",
      running: false,
      lastRun: null,
      tournaments: [],
      matches: [],
      generatedCards: [],
      generatedEvents: [],
      logs: [],
      notifications: [],
      jobs: [],
      pickems: {},
      processed: [],

      setSource: (s) => set({ source: s }),

      run: async () => {
        if (get().running) return;
        set({ running: true });
        const state = get();
        const source = state.source === "vlr" && isVlrConfigured() ? vlrSource : mockSource;
        const report = await runEngine(source, state.processed);

        // Cartas nuevas (dedupe). Aplica al juego las de alta confianza.
        const existing = new Set(state.generatedCards.map(cardKey));
        const fresh = report.cards.filter((c) => !existing.has(cardKey(c)));
        const appliedTournaments = new Set(state.processed);
        for (const c of fresh) {
          if (c.status === "applied") applyCard(c);
          appliedTournaments.add(c.tournamentId);
        }

        const telegramOn = isTelegramConfigured();
        const notifs = report.notifications.map((n) => ({ ...n, sentTelegram: telegramOn }));
        for (const n of notifs) void dispatchTelegram(`[${n.code}] ${n.message}`);

        const mergedEvents = [...state.generatedEvents];
        for (const ev of report.events) if (!mergedEvents.some((e) => e.id === ev.id)) mergedEvents.push(ev);

        set({
          running: false,
          lastRun: Date.now(),
          tournaments: report.tournaments,
          matches: report.matches,
          jobs: report.jobs,
          generatedCards: [...fresh, ...state.generatedCards].slice(0, 500),
          generatedEvents: mergedEvents,
          logs: [...report.logs, ...state.logs].slice(0, 200),
          notifications: [...notifs, ...state.notifications].slice(0, 100),
          processed: [...appliedTournaments],
        });
      },

      approveCard: (id) => {
        const card = get().generatedCards.find((c) => c.id === id);
        if (!card || card.status !== "pending") return;
        applyCard(card);
        set((s) => ({
          generatedCards: s.generatedCards.map((c) => (c.id === id ? { ...c, status: "applied" } : c)),
        }));
      },

      rejectCard: (id) =>
        set((s) => ({
          generatedCards: s.generatedCards.map((c) => (c.id === id ? { ...c, status: "rejected" } : c)),
        })),

      tick: () => {
        const now = Date.now();
        const due = dueJobs(get().jobs, now);
        if (due.length === 0) return;
        const ids = new Set(due.map((j) => j.id));
        set((s) => ({
          jobs: s.jobs.map((j) => (ids.has(j.id) ? { ...j, status: "done" } : j)),
          logs: [
            { id: `log_t_${now}`, at: now, level: "info" as const, module: "Scheduler", message: `Ejecutados ${due.length} trabajos de monitor.` },
            ...s.logs,
          ].slice(0, 200),
        }));
      },

      setPick: (matchId, team) =>
        set((s) => ({
          pickems: { ...s.pickems, [matchId]: { matchId, pick: team, resolved: false, at: Date.now() } },
        })),

      resolvePickems: () => {
        const { pickems, matches } = get();
        const game = useGameStore.getState();
        let rewarded = 0;
        const next = { ...pickems };
        for (const p of Object.values(pickems)) {
          if (p.resolved) continue;
          const m = matches.find((x) => x.id === p.matchId);
          if (!m || m.status !== "finished" || !m.winner) continue;
          const correct = p.pick === m.winner;
          next[p.matchId] = { ...p, resolved: true, correct };
          if (correct) {
            game.addCredits(1500);
            game.addXp(60);
            game.grantPack("estandar", 1);
            rewarded++;
          }
        }
        set((s) => ({
          pickems: next,
          ...(rewarded
            ? { notifications: [makeNotification("info", "info", `Pick'ems acertados: ${rewarded} · recompensas otorgadas`), ...s.notifications].slice(0, 100) }
            : {}),
        }));
      },

      simulateFinish: (matchId, winner) => {
        set((s) => ({
          matches: s.matches.map((m) => (m.id === matchId ? { ...m, status: "finished", winner } : m)),
        }));
        get().resolvePickems();
      },

      resetEngine: () =>
        set({
          tournaments: [], matches: [], generatedCards: [], generatedEvents: [],
          logs: [], notifications: [], jobs: [], pickems: {}, processed: [], lastRun: null,
        }),
    }),
    {
      name: "drl-champions-engine",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        source: s.source,
        generatedCards: s.generatedCards,
        generatedEvents: s.generatedEvents,
        notifications: s.notifications,
        pickems: s.pickems,
        processed: s.processed,
        lastRun: s.lastRun,
      }),
    },
  ),
);
