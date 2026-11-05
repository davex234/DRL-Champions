/**
 * F83 · CURVA DE XP Y NIVEL (puro). El nivel NO se guarda: se deriva SIEMPRE de la XP total con los umbrales congelados
 * de la temporada. Así «XP dice 12.000 pero nivel dice 17» no puede ocurrir.
 *
 * Curva progresiva por escalones: subir del nivel n-1 al n cuesta `base + step × (n − 1)`.
 */
export function buildLevels(maxLevel: number, base: number, step: number): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let n = 1; n <= maxLevel; n++) { acc += base + step * (n - 1); out.push(acc); }
  return out;
}

export interface LevelProgress {
  level: number;
  maxLevel: number;
  xp: number;
  /** XP dentro del nivel actual y la que falta para el siguiente (0 en el máximo). */
  xpIntoLevel: number;
  xpForNext: number;
  /** 0–1. En el máximo, 1. */
  progress: number;
  isMax: boolean;
}

/** Nivel = cuántos umbrales alcanza la XP. 0 XP = nivel 0. La XP por encima del máximo se registra pero no da niveles. */
export function levelFor(xp: number, levels: readonly number[]): number {
  let n = 0;
  for (const t of levels) { if (xp >= t) n++; else break; }
  return n;
}

export function levelProgress(xp: number, levels: readonly number[]): LevelProgress {
  const safe = Math.max(0, Math.floor(xp));
  const level = levelFor(safe, levels);
  const maxLevel = levels.length;
  if (level >= maxLevel) return { level: maxLevel, maxLevel, xp: safe, xpIntoLevel: 0, xpForNext: 0, progress: 1, isMax: true };
  const floor = level === 0 ? 0 : levels[level - 1];
  const next = levels[level];
  return { level, maxLevel, xp: safe, xpIntoLevel: safe - floor, xpForNext: next - floor, progress: (safe - floor) / (next - floor), isMax: false };
}

/** Curva válida: estrictamente creciente, positiva y del tamaño del nivel máximo. */
export function curveValid(levels: readonly number[], maxLevel: number): boolean {
  if (levels.length !== maxLevel || maxLevel < 1) return false;
  let prev = 0;
  for (const t of levels) { if (!Number.isInteger(t) || t <= prev) return false; prev = t; }
  return true;
}
