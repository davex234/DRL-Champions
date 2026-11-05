/**
 * FASE 43 · ESTADÍSTICA DESCRIPTIVA (PURO). Media, mediana, extremos, dispersión, cuantiles y rango
 * percentil. Sin reloj, sin azar, sin estado. Toda cifra de la capa estratégica sale de aquí.
 */

export interface Summary {
  n: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  /** Desviación típica POBLACIONAL (divide por n): describe las cartas que hay, no estima nada. */
  sd: number;
  range: number;
}

export const EMPTY_SUMMARY: Summary = { n: 0, mean: 0, median: 0, min: 0, max: 0, sd: 0, range: 0 };

export function summarize(values: readonly number[]): Summary {
  const n = values.length;
  if (n === 0) return EMPTY_SUMMARY;
  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  for (const v of sorted) sum += v;
  const mean = sum / n;
  let sq = 0;
  for (const v of sorted) sq += (v - mean) * (v - mean);
  const median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { n, mean, median, min: sorted[0], max: sorted[n - 1], sd: Math.sqrt(sq / n), range: sorted[n - 1] - sorted[0] };
}

/** Cuantil con interpolación lineal (tipo 7 de Hyndman–Fan, el de R/NumPy por defecto). `sorted` ascendente. */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const h = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** Primer índice con `sorted[i] >= x`. */
function lowerBound(sorted: readonly number[], x: number): number {
  let lo = 0; let hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}
/** Primer índice con `sorted[i] > x`. */
function upperBound(sorted: readonly number[], x: number): number {
  let lo = 0; let hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= x) lo = mid + 1; else hi = mid; }
  return lo;
}

/**
 * RANGO PERCENTIL de punto medio, en [0, 100]: % de la referencia por debajo de `x` más la mitad de los
 * iguales. Un valor igual a todos da 50; por encima de todos, 100. Determinista (búsqueda binaria).
 */
export function percentileRank(sorted: readonly number[], x: number): number {
  const n = sorted.length;
  if (n === 0 || !Number.isFinite(x)) return 50;
  const below = lowerBound(sorted, x);
  const equal = upperBound(sorted, x) - below;
  return (100 * (below + equal / 2)) / n;
}

/** Redondeo a un decimal para pantalla (el cálculo guarda el valor exacto). */
export const round1 = (x: number): number => Math.round(x * 10) / 10;

/** Número finito o 0: ninguna salida de la capa estratégica puede llevar NaN/Infinity. */
export const finite = (x: number): number => (Number.isFinite(x) ? x : 0);
