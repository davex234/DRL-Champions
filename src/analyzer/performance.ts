/**
 * PERFORMANCE ENGINE (Fase 3) — métricas compuestas 0..100 por jugador + confianza estadística.
 * REUTILIZA `accumulate`/`roleScores`/`kd` (escalas de referencia fijas de aggregate.ts): no crea
 * un segundo sistema de stats. La confianza depende SOLO de la cobertura de datos (nunca manual).
 * Puro, determinista, sin NaN/Infinity (todo clamp + divisores acotados).
 */
import type { CanonicalModel, MapPlayerStat } from "@/importer";
import { accumulate, roleScores, kd, clamp, groupBy, type StatLine } from "./aggregate";
import type { PlayerPerf } from "./rating";
import type { PerformanceMetrics, PerformanceConfidence, ConfidenceLevel } from "./types";

/** StatLine → PlayerPerf (adaptador único de F3; mismo mapeo que usa el Player Analyzer de F2). */
export const perfFromLine = (l: StatLine): PlayerPerf =>
  ({ acs: l.acs, kast: l.kast, kills: l.kills, deaths: l.deaths, assists: l.assists, clutches: l.clutches, hsPct: l.hsPct });

const r100 = (x: number): number => Math.round(clamp(x, 0, 1) * 100);

/** Campos estadísticos cuya presencia define la cobertura. */
const COVERAGE_FIELDS: ((s: MapPlayerStat) => number | undefined)[] = [
  (s) => s.acs, (s) => s.kast, (s) => s.adr, (s) => s.hsPct, (s) => s.kills,
  (s) => s.deaths, (s) => s.assists, (s) => s.fk, (s) => s.fd, (s) => s.clutches,
];

const coverageOf = (stats: MapPlayerStat[]): number => {
  if (!stats.length) return 0;
  let present = 0;
  for (const s of stats) for (const f of COVERAGE_FIELDS) if (typeof f(s) === "number") present++;
  return Math.round((present / (stats.length * COVERAGE_FIELDS.length)) * 1000) / 1000;
};

/** Rondas observadas de un conjunto de mapas: máximo entre rounds del modelo (pueden ser
 *  parciales) y la suma de scores (proxy completo cuando existe marcador). */
function roundsObserved(model: CanonicalModel, mapIds: Set<string>): number {
  let fromRounds = 0;
  for (const rd of model.rounds) if (mapIds.has(rd.matchMapId)) fromRounds++;
  let fromScores = 0;
  for (const id of mapIds) {
    const mm = model.index.mapById.get(id);
    if (mm && typeof mm.scoreA === "number" && typeof mm.scoreB === "number") fromScores += mm.scoreA + mm.scoreB;
  }
  return Math.max(fromRounds, fromScores);
}

/** Regla FIJA de confianza (documentada, solo cobertura de muestra — jamás manual). */
export function confidenceLevel(maps: number, matches: number, rounds: number, coverage: number): ConfidenceLevel {
  if (maps >= 5 && matches >= 2 && rounds >= 80 && coverage >= 0.7) return "high";
  if (maps >= 2 && rounds >= 30 && coverage >= 0.4) return "medium";
  return "low";
}

/** flexScore 0..100: nº de agentes distintos (evidencia observada; si no hay, los declarados). */
function flexScoreOf(statAgents: string[], declaredAgents: string[]): number {
  const counts = new Map<string, number>();
  for (const a of statAgents) counts.set(a, (counts.get(a) ?? 0) + 1);
  const n = counts.size || new Set(declaredAgents).size;
  if (n <= 1) return 0;
  let evenness = 0;
  if (counts.size > 1) {
    const total = statAgents.length;
    const maxShare = Math.max(...counts.values()) / total;
    evenness = clamp(1 - (maxShare - 1 / n) / (1 - 1 / n), 0, 1);
  }
  return r100(0.7 * clamp((n - 1) / 3, 0, 1) + 0.3 * evenness);
}

/** Métricas de performance F3 para TODOS los jugadores del modelo (orden por playerId). */
export function computePerformance(model: CanonicalModel): PerformanceMetrics[] {
  const byPlayer = groupBy(model.mapStats, (s) => s.playerId ?? "");
  const out: PerformanceMetrics[] = [];

  for (const p of model.players) {
    const stats = byPlayer.get(p.id) ?? [];
    const l = accumulate(stats);
    const roles = roleScores(l);

    // Compuestos con las MISMAS escalas de referencia que aggregate.ts (kd/1.5, adr/180, kast/100, clutch/1.2).
    const nKd = clamp(kd(l) / 1.5, 0, 1);
    const nAdr = clamp(l.adr / 180, 0, 1);
    const nKast = clamp(l.kast / 100, 0, 1);
    const nClutch = clamp(l.clutches / Math.max(1, l.maps) / 1.2, 0, 1);
    const efficiency = stats.length ? r100(0.4 * nKd + 0.35 * nAdr + 0.25 * nKast) : 0;
    const clutchScore = stats.length ? r100(0.8 * nClutch + 0.2 * nKd) : 0;

    const statAgents = stats.map((s) => s.agentId).filter((a): a is string => typeof a === "string");
    const flexScore = stats.length ? flexScoreOf(statAgents, p.agents ?? []) : 0;

    const mapIds = new Set(stats.map((s) => s.matchMapId));
    const matches = new Set(stats.map((s) => s.matchId)).size;
    const rounds = roundsObserved(model, mapIds);
    const coverage = coverageOf(stats);
    const confidence: PerformanceConfidence = {
      level: confidenceLevel(l.maps, matches, rounds, coverage),
      maps: l.maps, matches, rounds, coverage,
    };

    out.push({ playerId: p.id, efficiency, clutchScore, entryScore: roles.entry, supportScore: roles.support, flexScore, confidence });
  }
  return out.sort((a, b) => a.playerId.localeCompare(b.playerId));
}
