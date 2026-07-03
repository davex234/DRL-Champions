/**
 * XP / NIVELES (Collection Fase 6/7).
 *
 * Curva LINEAL determinista (xp por nivel constante) — nada de niveles infinitos ni RPG. Nivel acotado
 * a `maxLevel`. Puro. Reutiliza la idea de `passProgress` del sistema de eventos, generalizada.
 */
import type { SeasonDef, LevelProgress } from "./types";

/** XP total acumulada necesaria para ALCANZAR un nivel (nivel 0 = 0 xp). */
export function xpForLevel(level: number, season: SeasonDef): number {
  return Math.max(0, Math.min(level, season.maxLevel)) * season.xpPerLevel;
}

/** Progreso de nivel a partir de la XP acumulada. */
export function levelProgress(xp: number, season: SeasonDef): LevelProgress {
  const raw = Math.floor(Math.max(0, xp) / season.xpPerLevel);
  const level = Math.min(season.maxLevel, raw);
  const max = level >= season.maxLevel;
  const xpIntoLevel = max ? season.xpPerLevel : Math.max(0, xp) - level * season.xpPerLevel;
  return { level, xpIntoLevel, xpForNext: season.xpPerLevel, progress: max ? 1 : xpIntoLevel / season.xpPerLevel, max };
}

export const levelForXp = (xp: number, season: SeasonDef): number => levelProgress(xp, season).level;
