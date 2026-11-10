/**
 * MATCH NARRATIVE ENGINE — Sistema de importancia.
 *
 * No son constantes mágicas: es un MODELO. Cada evento tiene una importancia BASE
 * por tipo (y por magnitud, p. ej. el tamaño del clutch), modulada por el CONTEXTO
 * (lo tarde de la ronda, lo ajustado del marcador, punto de partido, si volteó la
 * ronda). El `impact` (cuánto movió el partido) se calcula al final con el
 * "leverage" de la ronda (cuán pivotal fue para el resultado).
 */
import type { NarrativeEventType } from "./types";

/** Importancia base por tipo (0..100, antes de contexto). */
export const BASE_IMPORTANCE: Record<NarrativeEventType, number> = {
  kill: 5,
  trade: 9,
  first_blood: 24,
  multikill: 22,          // escala con las bajas (ver baseImportance)
  ace: 88,
  clutch: 42,             // escala con el tamaño (1vN)
  plant: 16,
  defuse: 30,
  retake: 56,
  post_plant_hold: 20,
  execute_fast: 12,
  execute_slow: 11,
  eco_win: 50,
  timeout: 36,
  round_win: 14,
  tactical_shift: 32,
  momentum_shift: 52,
  confidence_shift: 26,
  economy_shift: 22,
  streak: 34,
  comeback_started: 62,
  collapse_started: 58,
  disappearance: 28,
  dominance: 40,
  rivalry: 24,
  inflection: 82,
  match_end: 100,
};

/** Importancia base teniendo en cuenta la magnitud (clutch 1vN, multikill 3/4/5). */
export function baseImportance(type: NarrativeEventType, data: Record<string, unknown>): number {
  if (type === "clutch") {
    const size = Number(data.clutchSize ?? 1); // enemigos vivos al quedarse solo
    return Math.min(100, BASE_IMPORTANCE.clutch + (size - 1) * 14); // 1v1≈42 … 1v5≈98
  }
  if (type === "multikill") {
    const k = Number(data.kills ?? 2);
    if (k >= 5) return BASE_IMPORTANCE.ace;
    return BASE_IMPORTANCE.multikill + (k - 2) * 12; // 2k≈22, 3k≈34, 4k≈46
  }
  return BASE_IMPORTANCE[type];
}

export interface ImportanceContext {
  round: number;
  /** Estimación del total de rondas (para "lo tarde que es"). */
  totalRoundsGuess: number;
  /** Marcador ajustado en ese momento (0 = paliza, 1 = empatadísimo). */
  closeness: number;
  /** Ganar esta ronda decide el partido. */
  matchPoint: boolean;
  /** El evento volteó el resultado esperado de la ronda. */
  swung: boolean;
}

/** Importancia FINAL (0..100) con contexto. */
export function scoreImportance(base: number, ctx: ImportanceContext): number {
  const roundShare = Math.min(1, ctx.round / Math.max(1, ctx.totalRoundsGuess));
  const lateMult = 0.8 + 0.4 * roundShare;       // las rondas tardías pesan más
  const closeMult = 1 + 0.3 * ctx.closeness;     // los partidos ajustados intensifican
  const mpMult = ctx.matchPoint ? 1.3 : 1;
  const swingMult = ctx.swung ? 1.2 : 1;
  return clamp100(base * lateMult * closeMult * mpMult * swingMult);
}

/**
 * Leverage de una ronda para el RESULTADO final (0.3..1.4): rondas tardías, en
 * marcador ajustado y dentro del tramo decisivo importan más. Se usa para el `impact`.
 */
export function roundLeverage(opts: {
  round: number;
  totalRounds: number;
  closeness: number;
  inDecisiveStretch: boolean;
}): number {
  const roundShare = opts.round / Math.max(1, opts.totalRounds);
  let lev = 0.3 + 0.6 * roundShare + 0.3 * opts.closeness;
  if (opts.inDecisiveStretch) lev += 0.2;
  return Math.max(0.3, Math.min(1.4, lev));
}

export const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));
