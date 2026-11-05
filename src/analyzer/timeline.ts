/**
 * PERFORMANCE TIMELINE (Fase 3) — serie partido a partido por jugador. MATERIALIZA lo que el
 * Player Analyzer de F2 ya computaba internamente (impactos por partido) y reducía a
 * trend/peak/worst. REUTILIZA `accumulate` + `rawPerformance` (mismas fórmulas, cero duplicación
 * de matemática nueva). Puro, determinista, O(n).
 */
import type { CanonicalModel } from "@/importer";
import { accumulate, groupBy } from "./aggregate";
import { rawPerformance } from "./rating";
import { perfFromLine } from "./performance";
import type { PerformanceTimeline } from "./types";

export function computeTimelines(model: CanonicalModel): PerformanceTimeline[] {
  // Mismo orden de partido que usa F2 (matchOrder ?? índice de aparición).
  const matchOrder = new Map(model.matches.map((m, i) => [m.id, m.matchOrder ?? i]));
  const byPlayer = groupBy(model.mapStats, (s) => s.playerId ?? "");

  const out: PerformanceTimeline[] = [];
  for (const [playerId, stats] of byPlayer) {
    if (!playerId) continue;
    const byMatch = groupBy(stats, (s) => s.matchId);
    const points = [...byMatch.entries()]
      .map(([matchId, ss]) => {
        const l = accumulate(ss);
        return {
          matchId,
          order: matchOrder.get(matchId) ?? 0,
          maps: l.maps,
          impact: Math.round(rawPerformance(perfFromLine(l))),
          acs: Math.round(l.acs),
          kills: l.kills,
          deaths: l.deaths,
        };
      })
      .sort((a, b) => a.order - b.order || a.matchId.localeCompare(b.matchId));
    out.push({ playerId, points });
  }
  return out.sort((a, b) => a.playerId.localeCompare(b.playerId));
}
