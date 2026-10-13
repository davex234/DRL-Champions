"use client";

/**
 * ROSTER BUILDER STORE — los EQUIPOS del entrenador (múltiples), persistentes.
 *
 * Cada equipo referencia cartas poseídas por uid (no copia stats). La validación
 * vive en `@/domain/teams/types` (pura) y se reutiliza aquí resolviendo los uids
 * contra la colección (`useGameStore`) + el catálogo. Persiste equipos, el equipo
 * activo y la última configuración táctica ("no perder nunca el equipo").
 *
 * Nota: NO confundir con `useRosterStore`, que es la base de datos de jugadores del
 * panel de administración. Esto son los EQUIPOS de 5 cartas del usuario-entrenador.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { getCard } from "@/data/catalog";
import { useGameStore } from "@/store/useGameStore";
import type { CoachSetup } from "@/sim";
import { validateTeam, DECK_SCHEMA_VERSION, type CardRef, type Team, type Deck, type DeckKind, type TeamError } from "@/domain/teams/types";
import { migrateDeck, cloneDeck, importDeck, exportDeck } from "@/deck/io";
import type { DeckExport } from "@/deck/types";
import { ns } from "@/i18n/runtime";

const tr = ns("store");

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `t_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Resuelve un uid de carta poseída a {uid, playerId} (o null si no existe). */
export function resolveCardRef(uid: string): CardRef | null {
  const owned = useGameStore.getState().ownedCards.find((o) => o.uid === uid);
  if (!owned) return null;
  const card = getCard(owned.cardId);
  if (!card) return null;
  return { uid, playerId: card.playerId };
}

interface TeamStore {
  teams: Team[];
  activeTeamId: string | null;
  /** Última configuración táctica usada (lado/approach/tempo/agresividad). */
  lastSetup: CoachSetup | null;

  createTeam: (name: string, kind?: DeckKind) => string;
  renameTeam: (id: string, name: string) => void;
  setLogo: (id: string, logo: string | undefined) => void;
  setStarters: (id: string, uids: string[]) => void;
  setSubs: (id: string, uids: string[]) => void;
  deleteTeam: (id: string) => void;
  setActiveTeam: (id: string | null) => void;
  markUsed: (id: string) => void;
  rememberSetup: (setup: CoachSetup) => void;

  // ── Deck & Squad Builder (Collection Fase 3/7) ──
  setKind: (id: string, kind: DeckKind) => void;
  setReserves: (id: string, uids: string[]) => void;
  setCaptain: (id: string, uid: string | undefined) => void;
  setIgl: (id: string, uid: string | undefined) => void;
  setCoach: (id: string, uid: string | undefined) => void;
  setTags: (id: string, tags: string[]) => void;
  toggleFavorite: (id: string) => void;
  /** Clona un deck (nueva copia); devuelve el nuevo id o null. */
  cloneTeam: (id: string) => string | null;
  /** Importa un deck desde JSON/objeto portable; devuelve el nuevo id o null. */
  importTeam: (raw: unknown) => string | null;
  /** Exporta un deck a su formato portable (o null si no existe). */
  exportTeam: (id: string) => DeckExport | null;

  getTeam: (id: string | null) => Team | undefined;
  /** Valida un equipo contra la colección actual. */
  validate: (id: string) => TeamError[];
}

const patch = (teams: Team[], id: string, fn: (t: Team) => Team): Team[] =>
  teams.map((t) => (t.id === id ? fn(t) : t));

/** Sella la última modificación (reloj en el borde del store). */
const touch = (t: Deck): Deck => ({ ...t, updatedAt: Date.now() });

export const useTeamStore = create<TeamStore>()(
  persist(
    (set, get) => ({
      teams: [],
      activeTeamId: null,
      lastSetup: null,

      createTeam: (name, kind = "custom") => {
        const id = newId();
        const now = Date.now();
        const team: Deck = {
          id,
          name: name.trim() || tr("Nuevo equipo"),
          starters: [],
          subs: [],
          reserves: [],
          kind,
          favorite: false,
          version: DECK_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now,
          lastUsedAt: null,
        };
        set((s) => ({ teams: [...s.teams, team], activeTeamId: s.activeTeamId ?? id }));
        return id;
      },

      renameTeam: (id, name) =>
        set((s) => ({ teams: patch(s.teams, id, (t) => touch({ ...t, name: name.trim() || t.name })) })),

      setLogo: (id, logo) =>
        set((s) => ({ teams: patch(s.teams, id, (t) => touch({ ...t, logo })) })),

      setStarters: (id, uids) =>
        set((s) => ({ teams: patch(s.teams, id, (t) => touch({ ...t, starters: [...uids] })) })),

      setSubs: (id, uids) =>
        set((s) => ({ teams: patch(s.teams, id, (t) => touch({ ...t, subs: [...uids] })) })),

      setKind: (id, kind) => set((s) => ({ teams: patch(s.teams, id, (t) => touch({ ...t, kind })) })),
      setReserves: (id, uids) => set((s) => ({ teams: patch(s.teams, id, (t) => touch({ ...t, reserves: [...uids] })) })),
      setCaptain: (id, uid) => set((s) => ({ teams: patch(s.teams, id, (t) => touch({ ...t, captainUid: uid })) })),
      setIgl: (id, uid) => set((s) => ({ teams: patch(s.teams, id, (t) => touch({ ...t, iglUid: uid })) })),
      setCoach: (id, uid) => set((s) => ({ teams: patch(s.teams, id, (t) => touch({ ...t, coachUid: uid })) })),
      setTags: (id, tags) => set((s) => ({ teams: patch(s.teams, id, (t) => touch({ ...t, tags: [...tags] })) })),
      toggleFavorite: (id) => set((s) => ({ teams: patch(s.teams, id, (t) => touch({ ...t, favorite: !t.favorite })) })),

      cloneTeam: (id) => {
        const src = get().teams.find((t) => t.id === id);
        if (!src) return null;
        const copy = cloneDeck(src, { id: newId(), now: Date.now() });
        set((s) => ({ teams: [...s.teams, copy] }));
        return copy.id;
      },

      importTeam: (raw) => {
        const deck = importDeck(raw, { id: newId(), now: Date.now() });
        if (!deck) return null;
        set((s) => ({ teams: [...s.teams, deck] }));
        return deck.id;
      },

      exportTeam: (id) => {
        const t = get().teams.find((x) => x.id === id);
        return t ? exportDeck(t) : null;
      },

      deleteTeam: (id) =>
        set((s) => {
          const teams = s.teams.filter((t) => t.id !== id);
          const activeTeamId = s.activeTeamId === id ? (teams[0]?.id ?? null) : s.activeTeamId;
          return { teams, activeTeamId };
        }),

      setActiveTeam: (id) => set({ activeTeamId: id }),

      markUsed: (id) =>
        set((s) => ({
          teams: patch(s.teams, id, (t) => ({ ...t, lastUsedAt: Date.now() })),
          activeTeamId: id,
        })),

      rememberSetup: (setup) => set({ lastSetup: setup }),

      getTeam: (id) => get().teams.find((t) => t.id === id),

      validate: (id) => {
        const team = get().teams.find((t) => t.id === id);
        if (!team) return [{ code: "UNKNOWN_CARD", message: tr("Equipo inexistente.") }];
        return validateTeam(team, resolveCardRef);
      },
    }),
    {
      name: "drl-champions-teams",
      version: DECK_SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ teams: s.teams, activeTeamId: s.activeTeamId, lastSetup: s.lastSetup }),
      // MIGRA los decks persistidos (equipos antiguos sin kind/reserves/version) al esquema actual.
      migrate: (persisted: unknown) => {
        const p = (persisted && typeof persisted === "object" ? persisted : {}) as { teams?: unknown[]; activeTeamId?: string | null; lastSetup?: CoachSetup | null };
        return {
          teams: Array.isArray(p.teams) ? p.teams.map((t) => migrateDeck(t)) : [],
          activeTeamId: typeof p.activeTeamId === "string" ? p.activeTeamId : null,
          lastSetup: p.lastSetup ?? null,
        };
      },
    },
  ),
);
