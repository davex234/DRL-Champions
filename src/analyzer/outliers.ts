/**
 * STATISTICAL OUTLIERS (Fase 3) — detección de valores atípicos por z-score sobre la población de
 * jugadores del torneo. Es la ÚNICA matemática nueva del módulo (media/desviación/z no existían en
 * src/). Reglas fijas: muestra mínima por jugador, población mínima por métrica, |z| ≥ 2.
 * Presencia estricta: un campo ausente NO cuenta como 0 (no envenena la población).
 * Puro, determinista, O(n·m) con m = nº de métricas (constante).
 */
import type { CanonicalModel, MapPlayerStat } from "@/importer";
import { groupBy } from "./aggregate";
import type { StatisticalOutlier, OutlierMetric } from "./types";

/** Mapas mínimos para que un jugador entre en la población. */
export const OUTLIER_MIN_MAPS = 2;
/** Jugadores mínimos en la población de una métrica (σ inestable por debajo). */
export const OUTLIER_MIN_POPULATION = 4;
/** Umbral |z| para considerar outlier. */
export const OUTLIER_Z = 2;

/** Media y desviación típica POBLACIONALES. */
export function meanStdev(xs: number[]): { mean: number; stdev: number } {
  if (!xs.length) return { mean: 0, stdev: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length;
  return { mean, stdev: Math.sqrt(variance) };
}

const present = (v: number | undefined): v is number => typeof v === "number";
const avgPresent = (stats: MapPlayerStat[], f: (s: MapPlayerStat) => number | undefined): number | undefined => {
  const vs = stats.map(f).filter(present);
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : undefined;
};
const sumPresent = (stats: MapPlayerStat[], f: (s: MapPlayerStat) => number | undefined): number | undefined => {
  const vs = stats.map(f).filter(present);
  return vs.length ? vs.reduce((a, b) => a + b, 0) : undefined;
};

/** Valor de cada métrica para un jugador — undefined si el dato no existe (presencia estricta). */
function metricValue(metric: OutlierMetric, stats: MapPlayerStat[]): number | undefined {
  const maps = Math.max(1, stats.length);
  switch (metric) {
    case "acs": return avgPresent(stats, (s) => s.acs);
    case "adr": return avgPresent(stats, (s) => s.adr);
    case "kast": return avgPresent(stats, (s) => s.kast);
    case "hsPct": return avgPresent(stats, (s) => s.hsPct);
    case "kd": {
      const k = sumPresent(stats, (s) => s.kills), d = sumPresent(stats, (s) => s.deaths);
      return k === undefined || d === undefined ? undefined : k / Math.max(1, d);
    }
    case "clutchesPerMap": { const c = sumPresent(stats, (s) => s.clutches); return c === undefined ? undefined : c / maps; }
    case "fkPerMap": { const f = sumPresent(stats, (s) => s.fk); return f === undefined ? undefined : f / maps; }
  }
}

const METRICS: readonly OutlierMetric[] = ["acs", "adr", "kast", "kd", "clutchesPerMap", "fkPerMap", "hsPct"];
const r2 = (x: number): number => Math.round(x * 100) / 100;

export function computeOutliers(model: CanonicalModel): StatisticalOutlier[] {
  const byPlayer = groupBy(model.mapStats, (s) => s.playerId ?? "");
  const eligible = [...byPlayer.entries()]
    .filter(([id, stats]) => id && stats.length >= OUTLIER_MIN_MAPS)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const out: StatisticalOutlier[] = [];
  for (const metric of METRICS) {
    const values = eligible
      .map(([playerId, stats]) => ({ playerId, value: metricValue(metric, stats) }))
      .filter((x): x is { playerId: string; value: number } => x.value !== undefined);
    if (values.length < OUTLIER_MIN_POPULATION) continue;
    const { mean, stdev } = meanStdev(values.map((v) => v.value));
    if (stdev <= 0) continue;
    for (const { playerId, value } of values) {
      const z = (value - mean) / stdev;
      if (Math.abs(z) < OUTLIER_Z) continue;
      out.push({
        playerId, metric,
        value: r2(value), mean: r2(mean), stdev: r2(stdev), zscore: r2(z),
        direction: z > 0 ? "high" : "low",
      });
    }
  }
  return out.sort((a, b) => Math.abs(b.zscore) - Math.abs(a.zscore) || a.playerId.localeCompare(b.playerId) || a.metric.localeCompare(b.metric));
}
