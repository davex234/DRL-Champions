/**
 * DRL PREDICT — modelo estadístico (fuente de verdad de las probabilidades).
 *
 * Combina la diferencia de Elo con la forma reciente, el H2H y la ventaja por
 * mapas en una "diferencia de rating efectiva", y la pasa por una logística.
 * El marcador se deriva resolviendo la probabilidad por mapa que reproduce la
 * probabilidad de serie. Todo PURO y determinista.
 */
import { expectedScore } from "./elo";
import type { MatchFeatures, ModelOutput } from "./types";

// Pesos (en puntos Elo equivalentes) de cada factor sobre la diferencia base.
const W_FORM = 220; // forma reciente (winrate)
const W_MOMENTUM = 120; // tendencia
const W_H2H = 140; // enfrentamiento directo
const W_MAP = 130; // ventaja en el pool de mapas

/** Diferencia de rating efectiva de A sobre B (en puntos Elo). */
export function effectiveDiff(f: MatchFeatures): number {
  const formDiff = f.formA.winRate - f.formB.winRate; // -1..1
  const momentumDiff = f.formA.momentum - f.formB.momentum; // -2..2
  const h2hTotal = f.h2h.gamesA + f.h2h.gamesB;
  const h2hEdge = h2hTotal > 0 ? (f.h2h.gamesA - f.h2h.gamesB) / h2hTotal : 0; // -1..1
  return (
    (f.eloA - f.eloB) +
    W_FORM * formDiff +
    W_MOMENTUM * (momentumDiff / 2) +
    W_H2H * h2hEdge +
    W_MAP * f.mapEdgeA
  );
}

/** Probabilidad de victoria del partido (no del mapa). */
export function matchWinProb(f: MatchFeatures): { pA: number; pB: number } {
  const diff = effectiveDiff(f);
  const pA = expectedScore(1500 + diff, 1500); // logística sobre la diferencia
  return { pA, pB: 1 - pA };
}

const winsNeeded = (bestOf: number): number => Math.floor(bestOf / 2) + 1;

/** Probabilidad de ganar una carrera "al mejor de" dado `q` por mapa. */
export function seriesWinProb(q: number, need: number): number {
  // P(ganar `need` mapas antes que el rival), sumando sobre mapas perdidos l.
  let p = 0;
  for (let l = 0; l < need; l++) {
    p += binom(need - 1 + l, l) * Math.pow(q, need) * Math.pow(1 - q, l);
  }
  return p;
}

function binom(n: number, k: number): number {
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/**
 * Marcador más probable. Invierte la probabilidad de serie para hallar la
 * probabilidad por mapa `q` que reproduce `pA`, y elige el nº de mapas del
 * perdedor más probable.
 */
export function predictScore(pA: number, bestOf: number): { a: number; b: number } {
  const need = winsNeeded(bestOf);
  if (bestOf <= 1) return pA >= 0.5 ? { a: 1, b: 0 } : { a: 0, b: 1 };

  const favored = pA >= 0.5;
  const target = favored ? pA : 1 - pA;
  // Búsqueda binaria de q en [0.5, 0.999] tal que seriesWinProb(q, need) = target.
  let lo = 0.5, hi = 0.999, q = 0.6;
  for (let i = 0; i < 40; i++) {
    q = (lo + hi) / 2;
    if (seriesWinProb(q, need) < target) lo = q;
    else hi = q;
  }
  // Nº de mapas del perdedor más probable (argmax sobre l=0..need-1).
  let bestL = 0, bestP = -1;
  for (let l = 0; l < need; l++) {
    const p = binom(need - 1 + l, l) * Math.pow(q, need) * Math.pow(1 - q, l);
    if (p > bestP) { bestP = p; bestL = l; }
  }
  return favored ? { a: need, b: bestL } : { a: bestL, b: need };
}

/** Confianza 0-1: separación de la probabilidad + volumen de muestra. */
export function confidence(f: MatchFeatures, pA: number): number {
  const separation = Math.abs(pA - 0.5) * 2; // 0..1
  const sample = Math.min(1, Math.min(f.formA.matches, f.formB.matches) / 8);
  return Math.round((0.35 + 0.45 * separation + 0.2 * sample) * 100) / 100;
}

/** Salida completa del modelo para un partido. */
export function runModel(f: MatchFeatures): ModelOutput {
  const { pA, pB } = matchWinProb(f);
  const score = predictScore(pA, f.bestOf);
  const winner = pA >= 0.5 ? f.teamAId : f.teamBId;
  return {
    winProbA: Math.round(pA * 1000) / 1000,
    winProbB: Math.round(pB * 1000) / 1000,
    predictedWinnerId: winner,
    predictedScoreA: score.a,
    predictedScoreB: score.b,
    confidence: confidence(f, pA),
    upsetRisk: Math.round(Math.min(pA, pB) * 1000) / 1000,
  };
}
