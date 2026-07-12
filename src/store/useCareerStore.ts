"use client";

/**
 * CAREER / DEVELOPMENT STORE — adaptador sobre el UNIVERSO ÚNICO (Consolidation F1.1).
 *
 * Antes este store mantenía un universo de desarrollo PARALELO al del Living World
 * (`useWorldStore`): el mismo jugador evolucionaba en dos verdades desconectadas según la
 * pantalla (/carrera vs /mundo//manager). Ahora el desarrollo vive en UN solo sitio:
 * `world.players[id].dev` (WorldPlayer.id === Player.id del catálogo). Este store:
 *
 *   · LEE/ESCRIBE el dev/innate de los jugadores DEL MUNDO (fuente autoritativa).
 *   · Mantiene un fallback local SOLO para ids que no existen en el mundo.
 *   · La QUÍMICA (pares) sigue aquí: es el único libro de relaciones (no está duplicada).
 *   · `advanceSeason` DELEGA en el avance unificado del mundo (mercado único + temporada);
 *     ya no hay dos relojes ni dos envejecimientos. `season` refleja `world.season`.
 *
 * Saves legacy: los registros dev/innate antiguos NO se borran; quedan como fallback para
 * ids fuera del mundo. Para ids del mundo, el mundo (sembrado del nivel de carta) manda.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { MatchState } from "@/match";
import type { RosterEntry } from "@/sim";
import type { WorldState } from "@/world";
import { useWorldStore } from "@/store/useWorldStore";
import {
  deriveInnate, freshDevState, extractExperience, evolveAfterMatch, train, advanceSeasonFor, autoProgress,
  applyDevelopment, teamChemistry, relKey, freshRelationship, updateChemistry, scoutPlayer, detectDevelopmentEvents,
  developmentBroadcast, progress,
  type InnateProfile, type DevState, type Relationship, type DevelopmentEvent, type DevTransition, type DevSnapshot,
  type TrainingSession, type ScoutReport, type DevelopmentInfo,
} from "@/development";

const idOf = (e: RosterEntry): string => e.meta?.playerId ?? e.name;
const egoOf = (e: RosterEntry): number => e.identity?.ego ?? 50;

function hashSeason(id: string, season: number): number {
  let h = (2166136261 ^ (season >>> 0)) >>> 0;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Universo único: el mundo persistido (lo crea determinista si aún no existe). */
const world = (): WorldState => useWorldStore.getState().ensure();
/** Publica la mutación del mundo (persist + notificación a suscriptores). */
const commitWorld = (w: WorldState): void => useWorldStore.setState({ world: { ...w } });

const snapOf = (d: DevState): DevSnapshot => ({ rating: progress(d), age: d.age, condition: { ...d.condition } });

interface CareerState {
  /** Reloj ÚNICO: espejo de `world.season` (se sincroniza en cada acción). */
  season: number;
  /** Fallback local SOLO para ids que no existen en el mundo (+ legado de saves antiguos). */
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
  /** Cierra temporada: avanza el MUNDO (mercado único + desarrollo de todos) — un solo reloj. */
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
        const w = world();
        const { dev, chem } = get();
        const ids = roster.map(idOf);
        const chemScore = teamChemistry(chem, ids);
        return roster.map((e, i) => {
          const d = w.players[ids[i]]?.dev ?? dev[ids[i]];
          return d ? applyDevelopment(e, d, { chemistry: chemScore }) : e;
        });
      },

      processMatch: (match) => {
        const w = world();
        const season = w.season;
        const nextDev = { ...get().dev };
        const nextInn = { ...get().innate };
        const nextChem = { ...get().chem };
        const transitions: DevTransition[] = [];
        let worldTouched = false;

        const signals = extractExperience(match);
        const sigById = Object.fromEntries(signals.map((s) => [s.playerId, s]));
        const egoById: Record<string, number> = {};
        for (const e of [...match.config.rosters.home, ...match.config.rosters.away]) egoById[idOf(e)] = egoOf(e);

        for (const sig of signals) {
          const id = sig.playerId;
          const wp = w.players[id];
          if (wp) {
            // UNIVERSO ÚNICO: el jugador existe en el mundo ⇒ evoluciona AHÍ.
            const { state, transition } = evolveAfterMatch(wp.dev, wp.innate, sig, season);
            wp.dev = state;
            worldTouched = true;
            transitions.push(transition);
          } else {
            // Fallback local (id fuera del mundo).
            if (!nextInn[id]) nextInn[id] = deriveInnate(id);
            if (!nextDev[id]) nextDev[id] = freshDevState(nextInn[id]);
            const { state, transition } = evolveAfterMatch(nextDev[id], nextInn[id], sig, season);
            nextDev[id] = state;
            transitions.push(transition);
          }
        }

        // Química: cada par del MISMO equipo que jugó junto (libro único, vive aquí).
        for (const lineup of [match.config.rosters.home, match.config.rosters.away]) {
          const ids = lineup.map(idOf);
          for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
            const a = ids[i], b = ids[j], key = relKey(a, b);
            const ambA = w.players[a]?.innate.ambition ?? nextInn[a]?.ambition ?? 50;
            const ambB = w.players[b]?.innate.ambition ?? nextInn[b]?.ambition ?? 50;
            if (!nextChem[key]) nextChem[key] = freshRelationship(a, b, ambA, ambB);
            const sa = sigById[a], sb = sigById[b];
            nextChem[key] = updateChemistry(nextChem[key], {
              won: sa?.won ?? sb?.won ?? false,
              impactX: sa?.impactScore ?? 0, impactY: sb?.impactScore ?? 0,
              egoX: egoById[a] ?? 50, egoY: egoById[b] ?? 50,
            });
          }
        }

        if (worldTouched) commitWorld(w);
        const names = Object.fromEntries(signals.map((s) => [s.playerId, s.name]));
        const newEvents = detectDevelopmentEvents(transitions, names);
        set({ season, dev: nextDev, innate: nextInn, chem: nextChem, events: [...get().events, ...newEvents].slice(-300) });
        return { transitions, events: newEvents };
      },

      runTraining: (playerIds, session) => {
        const w = world();
        const season = w.season;
        const nextDev = { ...get().dev };
        const nextInn = { ...get().innate };
        const transitions: DevTransition[] = [];
        let worldTouched = false;
        for (const id of playerIds) {
          const wp = w.players[id];
          if (wp) {
            const { state, transition } = train(wp.dev, wp.innate, session, season);
            wp.dev = state;
            worldTouched = true;
            transitions.push(transition);
          } else {
            if (!nextInn[id]) nextInn[id] = deriveInnate(id);
            if (!nextDev[id]) nextDev[id] = freshDevState(nextInn[id]);
            const { state, transition } = train(nextDev[id], nextInn[id], session, season);
            nextDev[id] = state;
            transitions.push(transition);
          }
        }
        if (worldTouched) commitWorld(w);
        const newEvents = detectDevelopmentEvents(transitions);
        set({ season, dev: nextDev, innate: nextInn, events: [...get().events, ...newEvents].slice(-300) });
        return { transitions, events: newEvents };
      },

      advanceSeason: (extraPlayerIds = []) => {
        // UN SOLO RELOJ: cerrar temporada = avanzar el MUNDO por el camino unificado
        // (mercado único + desarrollo de TODOS los jugadores del mundo). Este store solo
        // envejece su fallback local (ids fuera del mundo) y narra lo ocurrido.
        const before = world();
        const playedSeason = before.season;
        const snapBefore: Record<string, DevSnapshot> = {};
        const names: Record<string, string> = {};
        for (const p of Object.values(before.players)) {
          if (p.status !== "active") continue;
          snapBefore[p.id] = snapOf(p.dev);
          names[p.id] = p.nick;
        }

        useWorldStore.getState().advance();
        const w = world();

        // Transiciones de temporada sintetizadas (before/after) para la narrativa de /carrera.
        const transitions: DevTransition[] = [];
        for (const [id, beforeSnap] of Object.entries(snapBefore)) {
          const p = w.players[id];
          if (!p) continue;
          transitions.push({
            playerId: id, name: names[id], cause: "season", season: playedSeason,
            before: beforeSnap, after: snapOf(p.dev),
            changes: { traits: {}, attrs: {}, skills: {} },
          });
        }

        // Fallback local: envejece a los seguidos fuera del mundo y auto-progresa a los extra.
        const nextDev = { ...get().dev };
        const nextInn = { ...get().innate };
        for (const id of Object.keys(nextDev)) {
          if (w.players[id]) continue; // el mundo ya lo evolucionó (autoritativo)
          const { state, transition } = advanceSeasonFor(nextDev[id], nextInn[id] ?? deriveInnate(id), playedSeason);
          nextDev[id] = state;
          transitions.push(transition);
        }
        for (const id of extraPlayerIds) {
          if (w.players[id] || nextDev[id]) continue;
          if (!nextInn[id]) nextInn[id] = deriveInnate(id);
          const fresh = freshDevState(nextInn[id]);
          const { state, transition } = autoProgress(fresh, nextInn[id], playedSeason, hashSeason(id, playedSeason));
          nextDev[id] = state;
          transitions.push(transition);
        }

        const newEvents = detectDevelopmentEvents(transitions, names);
        set({ season: w.season, dev: nextDev, innate: nextInn, events: [...get().events, ...newEvents].slice(-300) });
        return { transitions, events: newEvents };
      },

      scout: (playerId) => {
        const wp = world().players[playerId];
        if (wp) return scoutPlayer(wp.innate, wp.dev);
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
        const wp = world().players[playerId];
        if (wp) return developmentBroadcast(wp.dev, wp.innate, name ?? wp.nick);
        const inn = get().innate[playerId];
        const d = get().dev[playerId];
        if (!inn || !d) return null;
        return developmentBroadcast(d, inn, name);
      },

      reset: () => set({ season: world().season, innate: {}, dev: {}, chem: {}, events: [] }),
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
