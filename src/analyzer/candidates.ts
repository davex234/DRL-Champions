/**
 * CANDIDATES (Fase 3) — All-Star five y Highlight candidates. El MVP NO se recalcula: se
 * re-expone el top-5 de F2 (misma fórmula mvpScore). All-Star: argmax de role score por puesto
 * (orden fijo de puestos, sin jugador repetido). Highlights: actuaciones de mapa con z ≥ 2 sobre
 * TODAS las stat-lines (generaliza los 3 récords hardcodeados de F2 sin sustituirlos).
 * Puro, determinista, O(n).
 */
import type { CanonicalModel, MapPlayerStat } from "@/importer";
import type { PlayerReport, AllStarSlot, AllStarSlotKind, HighlightCandidate, HighlightMetric } from "./types";
import { meanStdev, OUTLIER_MIN_POPULATION, OUTLIER_Z } from "./outliers";

/** Orden fijo de puestos (determinista) y rol que puntúa cada uno. */
const SLOTS: readonly { slot: AllStarSlotKind; score: (p: PlayerReport) => number }[] = [
  { slot: "duelist", score: (p) => p.roles.duelist },
  { slot: "controller", score: (p) => p.roles.controller },
  { slot: "initiator", score: (p) => p.roles.initiator },
  { slot: "sentinel", score: (p) => p.roles.sentinel },
  { slot: "flex", score: (p) => p.mvpScore },
];

/** Quinteto all-star: para cada puesto, el mejor jugador NO usado (empate → mvpScore → id). */
export function computeAllStar(players: PlayerReport[]): AllStarSlot[] {
  const used = new Set<string>();
  const out: AllStarSlot[] = [];
  for (const { slot, score } of SLOTS) {
    let best: PlayerReport | undefined, bestV = -Infinity;
    for (const p of players) {
      if (used.has(p.playerId) || p.maps === 0) continue;
      const v = score(p);
      if (v > bestV || (v === bestV && best && (p.mvpScore > best.mvpScore || (p.mvpScore === best.mvpScore && p.playerId < best.playerId)))) {
        bestV = v; best = p;
      }
    }
    if (!best) continue; // menos jugadores que puestos → se omite el puesto (nunca se inventa)
    used.add(best.playerId);
    out.push({ slot, playerId: best.playerId, score: Math.round(bestV) });
  }
  return out;
}

const HIGHLIGHT_METRICS: readonly { metric: HighlightMetric; of: (s: MapPlayerStat) => number | undefined }[] = [
  { metric: "acs", of: (s) => s.acs },
  { metric: "kills", of: (s) => s.kills },
  { metric: "clutches", of: (s) => s.clutches },
  { metric: "fk", of: (s) => s.fk },
  { metric: "adr", of: (s) => s.adr },
  { metric: "hsPct", of: (s) => s.hsPct },
];

/** Tope documentado de candidatos (los de mayor z; el resto no aporta a la fase de cartas). */
export const HIGHLIGHT_CAP = 20;
const r2 = (x: number): number => Math.round(x * 100) / 100;

/** Actuaciones de mapa estadísticamente excepcionales (solo lado alto: z ≥ 2). */
export function computeHighlights(model: CanonicalModel): HighlightCandidate[] {
  const out: HighlightCandidate[] = [];
  for (const { metric, of } of HIGHLIGHT_METRICS) {
    const lines = model.mapStats.filter((s) => typeof s.playerId === "string" && typeof of(s) === "number");
    if (lines.length < OUTLIER_MIN_POPULATION) continue;
    const { mean, stdev } = meanStdev(lines.map((s) => of(s)!));
    if (stdev <= 0) continue;
    for (const s of lines) {
      const z = (of(s)! - mean) / stdev;
      if (z < OUTLIER_Z) continue;
      out.push({ playerId: s.playerId!, matchId: s.matchId, matchMapId: s.matchMapId, metric, value: r2(of(s)!), zscore: r2(z) });
    }
  }
  return out
    .sort((a, b) => b.zscore - a.zscore || a.playerId.localeCompare(b.playerId) || a.matchMapId.localeCompare(b.matchMapId) || a.metric.localeCompare(b.metric))
    .slice(0, HIGHLIGHT_CAP);
}
