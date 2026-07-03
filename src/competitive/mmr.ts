/**
 * MMR ENGINE — REUTILIZA el Elo existente (Online Fase 3/7).
 *
 * `updateElo`/`expectedScore`/`marginMultiplier`/`DEFAULT_RATING`/`DEFAULT_K` de
 * `@/domain/esports/predict/elo`. NO crea otro Elo. K-factor por placements/liga alta/racha;
 * el margen de rondas amplifica (reutilizado). PURO. Determinista.
 */
import { updateElo, expectedScore, marginMultiplier, DEFAULT_RATING, DEFAULT_K } from "@/domain/esports/predict/elo";
import type { CompetitiveProfile } from "./types";

export const PLACEMENT_GAMES = 10;
export { DEFAULT_RATING, expectedScore };

/** K dinámico: mucho en placements, algo menos en ligas altas, plus por racha. */
export function kFactor(p: CompetitiveProfile): number {
  if (p.placementGames < PLACEMENT_GAMES) return 60;                 // placements = alta volatilidad
  const high = p.mmr >= 2100 ? 0.6 : p.mmr >= 1800 ? 0.8 : 1;        // ligas altas se mueven menos
  const streakBoost = Math.abs(p.streak) >= 3 ? 1.15 : 1;            // rachas aceleran un poco
  return Math.round(DEFAULT_K * high * streakBoost);
}

/** Delta de MMR de un partido (suma cero con el rival). Reutiliza `updateElo` + margen de rondas. */
export function mmrDelta(mmr: number, opponentMmr: number, won: boolean, scoreA: number, scoreB: number, k: number): number {
  const mult = marginMultiplier(scoreA, scoreB);
  return updateElo(mmr, opponentMmr, won ? 1 : 0, k, mult).deltaA;
}

/** Modificador por rendimiento (MVP). Pequeño: el resultado manda, no el farmeo. */
export function performanceBonus(mvp: boolean): number { return mvp ? 3 : 0; }
