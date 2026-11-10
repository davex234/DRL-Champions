/**
 * MANAGER CAREER ENGINE — historial (palmarés y crónica).
 *
 * El historial es APPEND-ONLY: equipos, títulos, finales, derrotas, MVPs y temporadas.
 * NUNCA se borra. Helpers puros que devuelven nuevas estructuras (no mutan).
 */
import type { CareerHistory, CareerSeasonRecord, SeasonOutcome } from "./types";

export function emptyHistory(): CareerHistory {
  return { spells: [], titles: [], results: [], seasons: [] };
}

/** Registra el fichaje por un equipo (cierra el spell anterior si lo hay). */
export function joinTeam(history: CareerHistory, team: string, season: number): CareerHistory {
  const spells = history.spells.map((s) =>
    s.toSeason === null && s.team !== team ? { ...s, toSeason: season } : s,
  );
  // Si ya está en ese equipo y abierto, no duplicar.
  const open = spells.find((s) => s.team === team && s.toSeason === null);
  if (!open) spells.push({ team, fromSeason: season, toSeason: null });
  return { ...history, spells };
}

/** Vuelca el resultado de una temporada al palmarés/crónica. */
export function recordSeason(history: CareerHistory, o: SeasonOutcome, season: number, reputationEnd: number): CareerHistory {
  const next: CareerHistory = {
    spells: history.spells,
    titles: history.titles.slice(),
    results: history.results.slice(),
    seasons: history.seasons.slice(),
  };
  if (o.champion) {
    next.titles.push({ season, team: o.team, competition: o.competition, tier: o.tier });
    next.results.push({ season, team: o.team, competition: o.competition, kind: "champion" });
  } else if (o.finalist) {
    next.results.push({ season, team: o.team, competition: o.competition, kind: "final" });
  } else {
    next.results.push({ season, team: o.team, competition: o.competition, kind: "defeat" });
  }
  const rec: CareerSeasonRecord = {
    season,
    team: o.team,
    wins: o.wins,
    losses: o.losses,
    titles: o.champion ? 1 : 0,
    finals: o.finalist || o.champion ? 1 : 0,
    reputationEnd: Math.round(reputationEnd),
  };
  next.seasons.push(rec);
  return next;
}
