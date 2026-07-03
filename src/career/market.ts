/**
 * MANAGER CAREER ENGINE · Fase 2 — mercado de entrenadores.
 *
 * Clasifica el mercado vivo de entrenadores (libres/ocupados/leyendas/rookies) a partir de
 * los `WorldCoach` del Living World (REUSADOS, no duplicados). Puro.
 */
import type { CoachMarket, CoachMarketRow } from "./types";

/** Entrada mínima compatible con `WorldCoach` (desacoplada para no importar `@/world`). */
export interface CoachLike {
  id: string;
  name: string;
  rating: number;
  titles: number;
  seasons: number;
  teamId: string | null;
}

const row = (c: CoachLike): CoachMarketRow => ({ id: c.id, name: c.name, rating: c.rating, titles: c.titles, seasons: c.seasons, teamId: c.teamId });

/** Clasifica una lista de entrenadores (del mundo + el usuario). Determinista. */
export function classifyMarket(coaches: CoachLike[]): CoachMarket {
  const free: CoachMarketRow[] = [];
  const occupied: CoachMarketRow[] = [];
  const legends: CoachMarketRow[] = [];
  const rookies: CoachMarketRow[] = [];
  for (const c of coaches) {
    const r = row(c);
    if (c.titles >= 5 || c.rating >= 88) legends.push(r);
    if (c.seasons <= 1 && c.titles === 0) rookies.push(r);
    if (c.teamId) occupied.push(r); else free.push(r);
  }
  const byRating = (a: CoachMarketRow, b: CoachMarketRow) => b.rating - a.rating;
  return {
    free: free.sort(byRating),
    occupied: occupied.sort(byRating),
    legends: legends.sort((a, b) => b.titles - a.titles || b.rating - a.rating),
    rookies: rookies.sort(byRating),
  };
}
