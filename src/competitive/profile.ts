/**
 * COMPETITIVE PROFILE — el perfil competitivo y su ÚNICO reductor (Online Fase 3/7).
 *
 * `recordMatch` es la única vía de actualización: MMR (Elo reutilizado) → placements → división →
 * serie de promoción → rank shield → descenso → racha → estadísticas de temporada. Idempotente por
 * matchId (anti doble-actualización). PURO y DETERMINISTA. Reutiliza career (coachRating) informativo.
 */
import type { Region } from "@/domain/cards/types";
import type { CompetitiveProfile, PromotionSeries, LeagueId, RankEvent, SeasonRecord } from "./types";
import { LEAGUES, leagueForMmr, divisionForMmr, leagueOrdinal, isApex, divisionsOf, rankLabel, rankOrdinal } from "./leagues";
import { kFactor, mmrDelta, performanceBonus, PLACEMENT_GAMES, DEFAULT_RATING } from "./mmr";

export interface MatchInput { matchId: string; won: boolean; opponentMmr: number; scoreFor: number; scoreAgainst: number; mvp: boolean; at: number }

function freshSeason(season: number, mmr: number): SeasonRecord {
  return { season, wins: 0, losses: 0, peakMmr: mmr, peakLeague: null, endMmr: mmr, endLeague: null };
}

export function newProfile(id: string, name: string, region: Region = "EMEA", opts: { coachRating?: number; season?: number } = {}): CompetitiveProfile {
  return {
    id, name, region, mmr: DEFAULT_RATING, peakMmr: DEFAULT_RATING, placementGames: 0,
    league: null, division: 0, series: null, shieldGames: 0, wins: 0, losses: 0, streak: 0, mvps: 0,
    coachRating: opts.coachRating ?? 0, season: freshSeason(opts.season ?? 1, DEFAULT_RATING), history: [],
    bestLeague: null, lastMatches: [], processed: [], lastActiveAt: 0,
  };
}

interface RankState { mmr: number; league: LeagueId | null; division: number; series: PromotionSeries | null; shieldGames: number }
type RankResult = { league: LeagueId | null; division: number; series: PromotionSeries | null; shieldGames: number; event: RankEvent["type"] | null };

/** Transición de rango tras actualizar el MMR (serie/shield/ascenso/descenso). PURO. */
function applyRank(s: RankState, won: boolean): RankResult {
  if (!s.league) return { league: s.league, division: s.division, series: s.series, shieldGames: s.shieldGames, event: null };
  if (s.series) {
    const series: PromotionSeries = { ...s.series, wins: s.series.wins + (won ? 1 : 0), losses: s.series.losses + (won ? 0 : 1) };
    if (series.wins >= series.needed) { const to = series.toLeague; return { league: to, division: isApex(to) ? 0 : divisionsOf(to), series: null, shieldGames: 3, event: "promoted" }; }
    if (series.losses > series.target - series.needed) return { league: s.league, division: s.division, series: null, shieldGames: s.shieldGames, event: "series_loss" };
    return { league: s.league, division: s.division, series, shieldGames: s.shieldGames, event: won ? "series_win" : null };
  }
  const curOrd = leagueOrdinal(s.league);
  const tgtOrd = leagueOrdinal(leagueForMmr(s.mmr));
  if (tgtOrd > curOrd) {
    const to = LEAGUES[curOrd + 1];
    return { league: s.league, division: s.division, series: { fromLeague: s.league, toLeague: to, wins: won ? 1 : 0, losses: won ? 0 : 1, target: 5, needed: 3 }, shieldGames: s.shieldGames, event: "series_start" };
  }
  if (tgtOrd < curOrd) {
    if (s.shieldGames > 0) return { league: s.league, division: s.division, series: null, shieldGames: s.shieldGames - 1, event: null }; // rank shield
    const to = LEAGUES[curOrd - 1];
    return { league: to, division: isApex(to) ? 0 : 1, series: null, shieldGames: 0, event: "demoted" };
  }
  return { league: leagueForMmr(s.mmr), division: divisionForMmr(s.mmr, leagueForMmr(s.mmr)), series: null, shieldGames: Math.max(0, s.shieldGames - (won ? 0 : 1)), event: null };
}

/** Aplica un partido al perfil. Idempotente por matchId. Devuelve el nuevo perfil + eventos de rango. */
export function recordMatch(p: CompetitiveProfile, m: MatchInput, now: number): { profile: CompetitiveProfile; events: RankEvent[] } {
  if (p.processed.includes(m.matchId)) return { profile: p, events: [] };   // SEGURIDAD: anti doble-actualización

  const rankBefore = rankLabel(p.league, p.division);
  const k = kFactor(p);
  const delta = Math.round(mmrDelta(p.mmr, m.opponentMmr, m.won, m.scoreFor, m.scoreAgainst, k) + performanceBonus(m.mvp));
  const mmr = Math.max(0, p.mmr + delta);
  const streak = m.won ? (p.streak >= 0 ? p.streak + 1 : 1) : (p.streak <= 0 ? p.streak - 1 : -1);
  const events: RankEvent[] = [];

  let league = p.league, division = p.division, series = p.series, shieldGames = p.shieldGames;
  const placementGames = Math.min(PLACEMENT_GAMES, p.placementGames + 1);

  if (p.placementGames + 1 >= PLACEMENT_GAMES && p.placementGames < PLACEMENT_GAMES && !p.league) {
    // Fin de placements: asigna liga inicial desde el MMR.
    league = leagueForMmr(mmr); division = divisionForMmr(mmr, league);
    events.push({ type: "placed", playerId: p.id, at: now, from: "Sin clasificar", to: rankLabel(league, division), detail: `Coloca en ${rankLabel(league, division)}` });
  } else if (p.league) {
    const r = applyRank({ mmr, league: p.league, division: p.division, series: p.series, shieldGames: p.shieldGames }, m.won);
    league = r.league; division = r.division; series = r.series; shieldGames = r.shieldGames;
    if (r.event) {
      const detail = r.event === "promoted" ? `Asciende a ${rankLabel(league, division)}`
        : r.event === "demoted" ? `Desciende a ${rankLabel(league, division)}`
        : r.event === "series_start" ? "Comienza la serie de promoción"
        : r.event === "series_win" ? "Gana un partido de la serie"
        : r.event === "series_loss" ? "Pierde la serie de promoción" : "";
      events.push({ type: r.event, playerId: p.id, at: now, from: rankBefore, to: rankLabel(league, division), detail });
    }
  }

  const peakMmr = Math.max(p.peakMmr, mmr);
  const season: SeasonRecord = { ...p.season, wins: p.season.wins + (m.won ? 1 : 0), losses: p.season.losses + (m.won ? 0 : 1), peakMmr: Math.max(p.season.peakMmr, mmr), endMmr: mmr, peakLeague: bestLeague(p.season.peakLeague, league), endLeague: league };
  const bestLg = bestLeague(p.bestLeague, league);

  const profile: CompetitiveProfile = {
    ...p, mmr, peakMmr, placementGames, league, division, series, shieldGames, streak,
    wins: p.wins + (m.won ? 1 : 0), losses: p.losses + (m.won ? 0 : 1), mvps: p.mvps + (m.mvp ? 1 : 0),
    season, bestLeague: bestLg,
    lastMatches: [{ matchId: m.matchId, won: m.won, mmrDelta: delta, at: m.at }, ...p.lastMatches].slice(0, 20),
    processed: [m.matchId, ...p.processed].slice(0, 60),
    lastActiveAt: now,
  };
  return { profile, events };
}

function bestLeague(a: LeagueId | null, b: LeagueId | null): LeagueId | null {
  if (!a) return b; if (!b) return a;
  return rankOrdinal(a, 1) >= rankOrdinal(b, 1) ? a : b;
}

export function winRate(p: CompetitiveProfile): number { const t = p.wins + p.losses; return t ? Math.round((p.wins / t) * 100) : 0; }
export function form(p: CompetitiveProfile, n = 5): number { const last = p.lastMatches.slice(0, n); return last.length ? Math.round((last.filter((x) => x.won).length / last.length) * 100) : 0; }
export function inPlacement(p: CompetitiveProfile): boolean { return p.placementGames < PLACEMENT_GAMES; }
export function rankOf(p: CompetitiveProfile): string { return inPlacement(p) ? `Placements ${p.placementGames}/${PLACEMENT_GAMES}` : rankLabel(p.league, p.division); }
