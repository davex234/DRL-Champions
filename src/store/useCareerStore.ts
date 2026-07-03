"use client";

/**
 * CAREER / DEVELOPMENT STORE — la progresión PERSISTENTE de los jugadores.
 *
 * Guarda el perfil innato, el estado de desarrollo, las relaciones (química), la
 * temporada y los eventos de evolución. NO contiene lógica: orquesta el Player
 * Development Engine (puro) y persiste su salida. Tras cada partido evoluciona a TODOS
 * los participantes (incluida la IA); el entrenador entrena; la temporada envejece a
 * todo el mundo. La inyección al sim ocurre en `developRoster` (deltas → RosterEntry).
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { MatchState } from "@/match";
import type { RosterEntry } from "@/sim";
import {
  deriveInnate, freshDevState, extractExperience, evolveAfterMatch, train, advanceSeasonFor, autoProgress,
  applyDevelopment, teamChemistry, relKey, freshRelationship, updateChemistry, scoutPlayer, detectDevelopmentEvents,
  developmentBroadcast,
  type InnateProfile, type DevState, type Relationship, type DevelopmentEvent, type DevTransition,
  type TrainingSession, type ScoutReport, type DevelopmentInfo,
} from "@/development";

const idOf = (e: RosterEntry): string => e.meta?.playerId ?? e.name;
const egoOf = (e: RosterEntry): number => e.identity?.ego ?? 50;

function hashSeason(id: string, season: number): number {
  let h = (2166136261 ^ (season >>> 0)) >>> 0;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

interface CareerState {
  season: number;
  innate: Record<string, InnateProfile>;
  dev: Record<string, DevState>;
  chem: Record<string, Relationship>;
  events: DevelopmentEvent[];

  /** Aplica el desarrollo persistido a un roster (deltas + química). El sim lo consume. */
  developRoster: (roster: RosterEntry[]) => RosterEntry[];
  /** Evoluciona a todos los participantes de un partido terminado (incluida la IA). */
  processMatch: (match: MatchState) => { transitions: DevTransition[]; events: DevelopmentEvent[] };
  /** Sesión de entrenamiento decidida por el entrenador. */
  runTraining: (playerIds: string[], session: TrainingSession) => { transitions: DevTransition[]; events: DevelopmentEvent[] };
  /** Cierra temporada: envejece a los seguidos y auto-progresa al resto del mundo. */
  advanceSeason: (extraPlayerIds?: string[]) => { transitions: DevTransition[]; events: DevelopmentEvent[] };
  /** Lectura de scouting de un jugador (lo crea si no existe). */
  scout: (playerId: string) => ScoutReport;
  /** Datos de desarrollo para broadcast/UI (null si no hay registro). */
  info: (playerId: string, name?: string) => DevelopmentInfo | null;
  reset: () => void;
}

export const useCareerStore = create<CareerState>()(
  persist(
    (set, get) => ({
      season: 1,
      innate: {},
      dev: {},
      chem: {},
      events: [],

      developRoster: (roster) => {
        const { dev, chem } = get();
        const ids = roster.map(idOf);
        const chemScore = teamChemistry(chem, ids);
        return roster.map((e, i) => {
          const d = dev[ids[i]];
          return d ? applyDevelopment(e, d, { chemistry: chemScore }) : e;
        });
      },

      processMatch: (match) => {
        const { season } = get();
        const nextDev = { ...get().dev };
        const nextInn = { ...get().innate };
        const nextChem = { ...get().chem };
        const transitions: DevTransition[] = [];

        const signals = extractExperience(match);
        const sigById = Object.fromEntries(signals.map((s) => [s.playerId, s]));
        const egoById: Record<string, number> = {};
        for (const e of [...match.config.rosters.home, ...match.config.rosters.away]) egoById[idOf(e)] = egoOf(e);

        for (const sig of signals) {
          const id = sig.playerId;
          if (!nextInn[id]) nextInn[id] = deriveInnate(id);
          if (!nextDev[id]) nextDev[id] = freshDevState(nextInn[id]);
          const { state, transition } = evolveAfterMatch(nextDev[id], nextInn[id], sig, season);
          nextDev[id] = state;
          transitions.push(transition);
        }

        // Química: cada par del MISMO equipo que jugó junto.
        for (const lineup of [match.config.rosters.home, match.config.rosters.away]) {
          const ids = lineup.map(idOf);
          for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
            const a = ids[i], b = ids[j], key = relKey(a, b);
            if (!nextChem[key]) nextChem[key] = freshRelationship(a, b, nextInn[a]?.ambition ?? 50, nextInn[b]?.ambition ?? 50);
            const sa = sigById[a], sb = sigById[b];
            nextChem[key] = updateChemistry(nextChem[key], {
              won: sa?.won ?? sb?.won ?? false,
              impactX: sa?.impactScore ?? 0, impactY: sb?.impactScore ?? 0,
              egoX: egoById[a] ?? 50, egoY: egoById[b] ?? 50,
            });
          }
        }

        const names = Object.fromEntries(signals.map((s) => [s.playerId, s.name]));
        const newEvents = detectDevelopmentEvents(transitions, names);
        set({ dev: nextDev, innate: nextInn, chem: nextChem, events: [...get().events, ...newEvents].slice(-300) });
        return { transitions, events: newEvents };
      },

      runTraining: (playerIds, session) => {
        const { season } = get();
        const nextDev = { ...get().dev };
        const nextInn = { ...get().innate };
        const transitions: DevTransition[] = [];
        for (const id of playerIds) {
          if (!nextInn[id]) nextInn[id] = deriveInnate(id);
          if (!nextDev[id]) nextDev[id] = freshDevState(nextInn[id]);
          const { state, transition } = train(nextDev[id], nextInn[id], session, season);
          nextDev[id] = state;
          transitions.push(transition);
        }
        const newEvents = detectDevelopmentEvents(transitions);
        set({ dev: nextDev, innate: nextInn, events: [...get().events, ...newEvents].slice(-300) });
        return { transitions, events: newEvents };
      },

      advanceSeason: (extraPlayerIds = []) => {
        const { season } = get();
        const nextDev = { ...get().dev };
        const nextInn = { ...get().innate };
        const transitions: DevTransition[] = [];
        // Envejece a los seguidos (los que han jugado/entrenado).
        for (const id of Object.keys(nextDev)) {
          const { state, transition } = advanceSeasonFor(nextDev[id], nextInn[id], season);
          nextDev[id] = state;
          transitions.push(transition);
        }
        // Auto-progresa al resto del mundo (Live Esports: todos progresan).
        for (const id of extraPlayerIds) {
          if (nextDev[id]) continue;
          if (!nextInn[id]) nextInn[id] = deriveInnate(id);
          const fresh = freshDevState(nextInn[id]);
          const { state, transition } = autoProgress(fresh, nextInn[id], season, hashSeason(id, season));
          nextDev[id] = state;
          transitions.push(transition);
        }
        const newEvents = detectDevelopmentEvents(transitions);
        set({ dev: nextDev, innate: nextInn, season: season + 1, events: [...get().events, ...newEvents].slice(-300) });
        return { transitions, events: newEvents };
      },

      scout: (playerId) => {
        let inn = get().innate[playerId];
        let d = get().dev[playerId];
        if (!inn || !d) {
          inn = inn ?? deriveInnate(playerId);
          d = d ?? freshDevState(inn);
          set({ innate: { ...get().innate, [playerId]: inn }, dev: { ...get().dev, [playerId]: d } });
        }
        return scoutPlayer(inn, d);
      },

      info: (playerId, name) => {
        const inn = get().innate[playerId];
        const d = get().dev[playerId];
        if (!inn || !d) return null;
        return developmentBroadcast(d, inn, name);
      },

      reset: () => set({ season: 1, innate: {}, dev: {}, chem: {}, events: [] }),
    }),
    {
      name: "drl-career-v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ season: s.season, innate: s.innate, dev: s.dev, chem: s.chem, events: s.events }),
      // Red de seguridad para futuros bumps: preserva la carrera persistida (zustand hace merge sobre
      // los defaults). Sin migrate, un bump de versión DESCARTA la carrera del usuario.
      migrate: (persisted) => (persisted && typeof persisted === "object" ? (persisted as Partial<CareerState>) : {}),
    },
  ),
);
