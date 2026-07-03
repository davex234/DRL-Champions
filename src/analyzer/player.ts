/**
 * PLAYER ANALYZER — informe objetivo por jugador derivado SOLO del Canonical Model.
 * Reutiliza `rawPerformance`/`contextualRating` (intel) para impacto/rating; calcula role scores,
 * consistencia, varianza, tendencia, peak/worst match y MVP score. Puro y determinista.
 */
import type { CanonicalModel } from "@/importer";
import type { PlayerReport } from "./types";
import { accumulate, roleScores, rolePerformance, kd, groupBy, clamp, type StatLine } from "./aggregate";
import { rawPerformance, contextualRating, stageFor, type PlayerPerf } from "./rating";
import type { TournamentType } from "@/engine/types";

const perfOf = (l: StatLine): PlayerPerf => ({ acs: l.acs, kast: l.kast, kills: l.kills, deaths: l.deaths, assists: l.assists, clutches: l.clutches, hsPct: l.hsPct });
const variance = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
};

/** teamSuccess: teamId → 0..1 (éxito en el torneo, para ponderar el MVP score). */
export function analyzePlayers(model: CanonicalModel, type: TournamentType, teamSuccess: Map<string, number>): PlayerReport[] {
  const byPlayer = groupBy(model.mapStats, (s) => s.playerId ?? "");
  const matchOrder = new Map(model.matches.map((m, i) => [m.id, m.matchOrder ?? i]));
  const matchRound = new Map(model.matches.map((m) => [m.id, m.round]));
  const mapToMatch = new Map(model.maps.map((mm) => [mm.id, mm.matchId]));

  const reports: PlayerReport[] = [];
  for (const p of model.players) {
    const stats = byPlayer.get(p.id) ?? [];
    const overall = accumulate(stats);

    // Por partido (para tendencia/varianza/peak/worst).
    const byMatch = groupBy(stats, (s) => s.matchId);
    const perMatch = [...byMatch.entries()]
      .map(([matchId, ss]) => ({ matchId, order: matchOrder.get(matchId) ?? 0, impact: rawPerformance(perfOf(accumulate(ss))) }))
      .sort((a, b) => a.order - b.order);

    const impacts = perMatch.map((x) => x.impact);
    const impact = Math.round(rawPerformance(perfOf(overall)));
    const varc = variance(impacts);
    const consistency = impacts.length < 2 ? (stats.length ? 100 : 0) : Math.round(clamp(100 - Math.sqrt(varc), 0, 100));

    // Stage más profundo alcanzado (para el peso contextual del rating).
    const deepest = perMatch.reduce<"groups" | "playoffs" | "final">((acc, x) => {
      const s = stageFor(matchRound.get(x.matchId));
      return s === "final" || acc === "final" ? "final" : s === "playoffs" || acc === "playoffs" ? "playoffs" : "groups";
    }, "groups");
    const rating = stats.length ? contextualRating(perfOf(overall), { type, stage: deepest }) : 0;

    // Tendencia: media 1ª mitad vs 2ª mitad.
    let trend: PlayerReport["trend"] = "unknown";
    if (impacts.length >= 2) {
      const half = Math.floor(impacts.length / 2);
      const a = impacts.slice(0, half), b = impacts.slice(impacts.length - half);
      const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
      trend = mb > ma + 5 ? "rising" : mb < ma - 5 ? "falling" : "steady";
    }

    const peak = perMatch.length ? perMatch.reduce((a, b) => (b.impact > a.impact ? b : a)) : undefined;
    const worst = perMatch.length ? perMatch.reduce((a, b) => (b.impact < a.impact ? b : a)) : undefined;

    const roles = roleScores(overall);
    const success = (p.teamId && teamSuccess.get(p.teamId)) || 0;
    const mvpScore = Math.round(clamp(0.5 * impact + 0.25 * rating + 0.25 * success * 100, 0, 100));

    reports.push({
      playerId: p.id, nick: p.nick, teamId: p.teamId, role: p.role,
      maps: overall.maps, matches: perMatch.length,
      acs: Math.round(overall.acs), adr: Math.round(overall.adr), kast: Math.round(overall.kast),
      kd: Math.round(kd(overall) * 100) / 100, hsPct: Math.round(overall.hsPct),
      kills: overall.kills, deaths: overall.deaths, assists: overall.assists, fk: overall.fk, fd: overall.fd, clutches: overall.clutches,
      rating, impact, consistency, variance: Math.round(varc),
      mvpScore, roles, rolePerformance: rolePerformance(roles, p.role), trend,
      peakMatchId: peak?.matchId, worstMatchId: worst?.matchId,
    });
  }
  // Orden determinista: por mvpScore desc, desempate por id.
  return reports.sort((a, b) => b.mvpScore - a.mvpScore || a.playerId.localeCompare(b.playerId));
}
