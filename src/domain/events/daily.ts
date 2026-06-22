import type { Reward } from "./types";

/**
 * Tabla de recompensas diarias (ciclo de 7 días). El día 3 da un sobre gratis
 * y el día 7 un Sobre Premium, como pide el diseño.
 */
export const DAILY_REWARDS: Reward[] = [
  { credits: 500 },
  { credits: 1000 },
  { packId: "inicial", packCount: 1 },
  { credits: 1500, tokens: 20 },
  { tokens: 60 },
  { credits: 2500 },
  { packId: "premium", packCount: 1 },
];

/** Recompensa correspondiente a una racha (1-indexada, cicla cada 7 días). */
export function dailyReward(streak: number): Reward {
  const idx = ((streak - 1) % DAILY_REWARDS.length + DAILY_REWARDS.length) % DAILY_REWARDS.length;
  return DAILY_REWARDS[idx];
}
