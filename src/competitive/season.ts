/**
 * SEASON ENGINE — temporadas competitivas + SOFT RESET (Online Fase 3/7).
 *
 * Al cerrar una temporada: archiva el registro al historial, comprime el MMR hacia el centro
 * (soft reset), reinicia serie/shield/racha y exige re-colocación (placements parciales). PURO.
 */
import type { CompetitiveProfile } from "./types";
import { PLACEMENT_GAMES, DEFAULT_RATING } from "./mmr";

export interface SeasonState { number: number; startedAt: number; endsAt: number | null }

export function newSeasonState(number: number, startedAt: number, length: number | null = null): SeasonState {
  return { number, startedAt, endsAt: length != null ? startedAt + length : null };
}

/** Cierra la temporada del perfil y aplica SOFT RESET hacia la siguiente. Determinista. */
export function softReset(p: CompetitiveProfile, nextSeason: number, now: number): CompetitiveProfile {
  const archived = { ...p.season, endMmr: p.mmr, endLeague: p.league };
  const target = DEFAULT_RATING;
  const mmr = Math.round(target + (p.mmr - target) * 0.5);   // comprime hacia el centro
  return {
    ...p, mmr, peakMmr: mmr,
    placementGames: Math.max(0, PLACEMENT_GAMES - 3),         // 3 partidas de recolocación
    league: null, division: 0, series: null, shieldGames: 0, streak: 0,
    history: [...p.history, archived].slice(-20),
    season: { season: nextSeason, wins: 0, losses: 0, peakMmr: mmr, peakLeague: null, endMmr: mmr, endLeague: null },
    lastActiveAt: now,
  };
}
