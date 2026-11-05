/**
 * COMPETITIVE PRESENTATION — vistas listas para pintar (Online Fase 3/7).
 *
 * El motor prepara; la UI pinta (patrón del proyecto). Perfil competitivo, ceremonia de
 * ascenso/descenso y leaderboards. Reutiliza Presentation/Broadcast por convención. PURO.
 */
import type { CompetitiveProfile, RankEvent, LeagueId } from "./types";
import { rankLabel, LEAGUE_LABEL } from "./leagues";
import { winRate, form, inPlacement, rankOf } from "./profile";
import type { Leaderboard } from "./leaderboard";

export interface CompetitiveProfileView {
  id: string; name: string; region: string;
  rank: string; mmr: number | null; peakMmr: number;
  wins: number; losses: number; winRate: number; streak: number; form: number; mvps: number;
  bestLeague: string | null; coachRating: number;
  inPlacement: boolean; placementGames: number;
  series: { toLeague: string; wins: number; losses: number; needed: number } | null;
  shieldGames: number;
  season: CompetitiveProfile["season"];
  history: CompetitiveProfile["history"];
}

export function profileView(p: CompetitiveProfile): CompetitiveProfileView {
  return {
    id: p.id, name: p.name, region: p.region,
    rank: rankOf(p), mmr: inPlacement(p) ? null : p.mmr, peakMmr: p.peakMmr,
    wins: p.wins, losses: p.losses, winRate: winRate(p), streak: p.streak, form: form(p), mvps: p.mvps,
    bestLeague: p.bestLeague ? LEAGUE_LABEL[p.bestLeague as LeagueId] : null, coachRating: p.coachRating,
    inPlacement: inPlacement(p), placementGames: p.placementGames,
    series: p.series ? { toLeague: LEAGUE_LABEL[p.series.toLeague], wins: p.series.wins, losses: p.series.losses, needed: p.series.needed } : null,
    shieldGames: p.shieldGames, season: p.season, history: p.history,
  };
}

export interface RankUpView { kind: RankEvent["type"]; title: string; from: string; to: string; detail: string; celebratory: boolean }
export function rankUpView(e: RankEvent): RankUpView {
  const titles: Record<RankEvent["type"], string> = { promoted: "¡ASCENSO!", demoted: "Descenso", series_start: "Serie de promoción", series_win: "Victoria de serie", series_loss: "Serie perdida", placed: "¡Colocado!", decayed: "Decaimiento" };
  return { kind: e.type, title: titles[e.type], from: e.from, to: e.to, detail: e.detail, celebratory: e.type === "promoted" || e.type === "placed" };
}

export function leaderboardView(board: Leaderboard, n = 100): { rank: number; id: string; name: string; mmr: number; rankLabelText: string }[] {
  return board.top(n).map((e, i) => ({ rank: i + 1, id: e.id, name: e.name, mmr: e.mmr, rankLabelText: rankLabel(e.league, e.division) }));
}
