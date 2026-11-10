"use client";

/**
 * COLECCIONES POR EQUIPO · AVISO DE RECOMPENSA PENDIENTE DE ENSEÑAR.
 *
 * La liquidación también ocurre en segundo plano (tras sincronizar con el servidor), lejos de Colecciones. Lo que se
 * acaba de guardar —equipos completados por primera vez, XP de temporada, insignias regionales— se deja aquí y lo enseña
 * `CollectionRewardNotice` en el armazón del juego. Se guarda también en `sessionStorage`: una recarga o una navegación
 * completa antes de enseñarlo no lo pierde. Se borra al enseñarse. Solo es presentación: el servidor ya lo guardó.
 */
import { create } from "zustand";

export interface RewardSummary {
  /** Títulos de los equipos completados por primera vez en esta liquidación. */
  first: string[];
  xp: number;
  regions: string[];
}

interface SettleLike { teams?: { title: string; first: boolean }[]; regions?: string[]; xpGained?: number }

/** Lo que merece un aviso, o null si la liquidación no guardó nada nuevo. */
export function summarizeSettle(r: unknown): RewardSummary | null {
  const s = (r ?? {}) as SettleLike;
  const first = (s.teams ?? []).filter((x) => x.first).map((x) => x.title);
  const xp = Math.max(0, Number(s.xpGained) || 0);
  const regions = [...(s.regions ?? [])];
  return first.length || xp || regions.length ? { first, xp, regions } : null;
}

const KEY = "drl-collection-reward";
const read = (): RewardSummary | null => {
  try { const v = sessionStorage.getItem(KEY); return v ? (JSON.parse(v) as RewardSummary) : null; } catch { return null; }
};
const write = (v: RewardSummary | null) => {
  try { if (v) sessionStorage.setItem(KEY, JSON.stringify(v)); else sessionStorage.removeItem(KEY); } catch { /* sin almacenamiento: solo en memoria */ }
};
/** Dos liquidaciones antes de enseñar el aviso se suman (nunca se pisa una recompensa sin enseñar). */
const merge = (a: RewardSummary | null, b: RewardSummary): RewardSummary =>
  a ? { first: [...a.first, ...b.first], xp: a.xp + b.xp, regions: [...new Set([...a.regions, ...b.regions])] } : b;

interface RewardNoticeState {
  pending: RewardSummary | null;
  push: (s: RewardSummary) => void;
  /** Devuelve lo pendiente (también lo guardado en esta pestaña) y lo borra. */
  take: () => RewardSummary | null;
}

export const useCollectionRewardStore = create<RewardNoticeState>((set, get) => ({
  pending: null,
  push: (s) => { const next = merge(get().pending ?? read(), s); write(next); set({ pending: next }); },
  take: () => { const v = get().pending ?? read(); write(null); set({ pending: null }); return v; },
}));
