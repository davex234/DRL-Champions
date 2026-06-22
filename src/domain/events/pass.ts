import type { EventDef, Reward } from "./types";

export interface PassProgress {
  level: number; // nivel alcanzado (0..max)
  xpIntoLevel: number;
  xpForNext: number;
  progress: number; // 0-1 hacia el siguiente nivel
  max: boolean;
}

/** Calcula el nivel del pase de evento a partir de la XP acumulada. */
export function passProgress(xp: number, ev: EventDef): PassProgress {
  const raw = Math.floor(xp / ev.passXpPerLevel);
  const level = Math.min(ev.passLevels, raw);
  const max = level >= ev.passLevels;
  const xpIntoLevel = max ? ev.passXpPerLevel : xp - level * ev.passXpPerLevel;
  return {
    level,
    xpIntoLevel,
    xpForNext: ev.passXpPerLevel,
    progress: max ? 1 : xpIntoLevel / ev.passXpPerLevel,
    max,
  };
}

/**
 * Recompensa de un nivel del pase. Usa el override del evento si existe; si no,
 * genera una recompensa por defecto (créditos/tokens, sobres en hitos).
 */
export function passRewardForLevel(ev: EventDef, level: number): Reward {
  if (ev.passRewards?.[level]) return ev.passRewards[level];
  if (level % 10 === 0 && ev.packIds[0]) {
    return { packId: ev.packIds[0], packCount: 1, tokens: 40 };
  }
  if (level % 5 === 0) return { tokens: 60, xp: 80 };
  return { credits: 400 + level * 40, tokens: 12 };
}
