/**
 * Sistema de nivel y experiencia. La XP se gana abriendo sobres y
 * completando logros. La curva es cuadrática suave: subir cuesta más
 * a medida que avanzas.
 */

/** XP total acumulada necesaria para alcanzar un nivel. */
export function totalXpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(100 * Math.pow(level - 1, 1.6));
}

export interface LevelInfo {
  level: number;
  /** XP dentro del nivel actual. */
  xpIntoLevel: number;
  /** XP necesaria para el siguiente nivel. */
  xpForNext: number;
  /** Progreso 0-1 hacia el siguiente nivel. */
  progress: number;
}

export function levelFromXp(xp: number): LevelInfo {
  let level = 1;
  while (totalXpForLevel(level + 1) <= xp) level++;
  const floor = totalXpForLevel(level);
  const ceil = totalXpForLevel(level + 1);
  const xpIntoLevel = xp - floor;
  const xpForNext = ceil - floor;
  return {
    level,
    xpIntoLevel,
    xpForNext,
    progress: xpForNext > 0 ? xpIntoLevel / xpForNext : 1,
  };
}

/** XP otorgada al obtener una carta según su rank de variante. */
export function xpForCardRank(rank: number): number {
  return 10 + rank * 8;
}
