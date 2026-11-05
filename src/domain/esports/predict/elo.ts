/**
 * DRL PREDICT — sistema Elo para equipos.
 *
 * Funciones PURAS. El rating se recomputa desde los partidos finalizados en
 * orden cronológico; la diferencia de mapas amplifica el ajuste (ganar 2-0 mueve
 * más que 2-1), igual que en los sistemas Elo deportivos modernos.
 */

export const DEFAULT_RATING = 1500;
export const DEFAULT_K = 32;

/** Probabilidad esperada de que A gane según la diferencia de rating. */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/** Multiplicador por margen de mapas (1.0 si no hay info de mapas). */
export function marginMultiplier(scoreA?: number, scoreB?: number): number {
  if (scoreA == null || scoreB == null) return 1;
  const margin = Math.abs(scoreA - scoreB);
  if (margin <= 0) return 1;
  // Crecimiento logarítmico suave: 1-0→1.0, 2-0→~1.5, 3-0→~1.8.
  return 1 + Math.log(1 + margin) / 1.6;
}

export interface EloUpdate {
  ratingA: number;
  ratingB: number;
  deltaA: number;
}

/**
 * Devuelve los nuevos ratings tras un partido. `scoreA01` es el resultado real
 * de A (1 gana, 0 pierde, 0.5 empate). El ajuste es de suma cero.
 */
export function updateElo(
  ratingA: number,
  ratingB: number,
  scoreA01: number,
  k: number = DEFAULT_K,
  marginMult = 1,
): EloUpdate {
  const expA = expectedScore(ratingA, ratingB);
  const deltaA = k * marginMult * (scoreA01 - expA);
  return { ratingA: ratingA + deltaA, ratingB: ratingB - deltaA, deltaA };
}
