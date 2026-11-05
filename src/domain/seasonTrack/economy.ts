/**
 * F83 · ECONOMÍA DE UNA TEMPORADA (pura): lo que el carril PUEDE dar como máximo y la SIMULACIÓN de perfiles de juego.
 * Se calcula sobre la DEFINICIÓN (no sobre usuarios): barato, se ve en el panel antes de publicar.
 */
import { levelFor } from "./curve";
import type { SeasonConfig } from "./types";

export interface EconomyTotals {
  credits: number;
  packs: { packId: string; count: number; unitPrice: number | null }[];
  /** Valor de los sobres a precio de tienda (créditos equivalentes). */
  packValue: number;
  badges: string[];
  rewardLevels: number;
  /** Créditos + valor de sobres. */
  totalValue: number;
}

export function economyTotals(config: SeasonConfig, priceOf: (packId: string) => number | null): EconomyTotals {
  let credits = 0;
  const packs = new Map<string, number>();
  const badges: string[] = [];
  for (const { reward: r } of config.rewards) {
    credits += r.credits ?? 0;
    if (r.packId && (r.packCount ?? 0) > 0) packs.set(r.packId, (packs.get(r.packId) ?? 0) + (r.packCount ?? 0));
    if (r.badge) badges.push(r.badge);
  }
  const list = [...packs.entries()].map(([packId, count]) => ({ packId, count, unitPrice: priceOf(packId) }));
  const packValue = list.reduce((s, p) => s + p.count * (p.unitPrice ?? 0), 0);
  return { credits, packs: list, packValue, badges, rewardLevels: config.rewards.length, totalValue: credits + packValue };
}

/** Un perfil de juego por semana (supuestos explícitos). */
export interface PlayProfile {
  id: string;
  label: string;
  daysPerWeek: number;
  matchesPerDay: number;
  winRate: number;
  /** Modo de las partidas (XP base media). */
  mode: "PVE" | "RANKED" | "DRAFT";
  /** Fracción de retos diarios / semanales que completa. */
  dailyShare: number;
  weeklyShare: number;
  craftsPerDay: number;
  /** Colecciones F82 completadas en la temporada. */
  collections: number;
}

export const PROFILES: PlayProfile[] = [
  { id: "casual", label: "Casual", daysPerWeek: 3, matchesPerDay: 2, winRate: 0.5, mode: "PVE", dailyShare: 0.6, weeklyShare: 0.4, craftsPerDay: 0, collections: 0 },
  { id: "regular", label: "Regular", daysPerWeek: 6, matchesPerDay: 5, winRate: 0.5, mode: "PVE", dailyShare: 1, weeklyShare: 0.8, craftsPerDay: 0, collections: 1 },
  { id: "high", label: "Muy activo", daysPerWeek: 7, matchesPerDay: 12, winRate: 0.55, mode: "PVE", dailyShare: 1, weeklyShare: 1, craftsPerDay: 2, collections: 2 },
  { id: "max", label: "Máximo legítimo", daysPerWeek: 7, matchesPerDay: 40, winRate: 0.6, mode: "RANKED", dailyShare: 1, weeklyShare: 1, craftsPerDay: 10, collections: 6 },
];

export interface ProfileResult {
  id: string; label: string;
  xpPerDay: number; xpPerWeek: number; xpSeason: number;
  levelAtEnd: number; daysToMax: number | null;
  credits: number; packs: number; packValue: number; badges: number;
}

const avg = (pool: { xp: number }[]) => (pool.length ? pool.reduce((s, c) => s + c.xp, 0) / pool.length : 0);

export function simulate(config: SeasonConfig, seasonDays: number, priceOf: (packId: string) => number | null, profiles = PROFILES): ProfileResult[] {
  const dailyXp = avg(config.challenges.daily.pool) * config.challenges.daily.count;
  const weeklyXp = avg(config.challenges.weekly.pool) * config.challenges.weekly.count;
  return profiles.map((p) => {
    const perMatch = config.xp.match[p.mode] + p.winRate * config.xp.match.winBonus;
    const matchDay = Math.min(config.xp.match.dailyCap, p.matchesPerDay * perMatch);
    const craftDay = Math.min(config.xp.craft.dailyCap, p.craftsPerDay * config.xp.craft.amount);
    const week = p.daysPerWeek * (matchDay + craftDay + dailyXp * p.dailyShare) + weeklyXp * p.weeklyShare;
    const season = Math.round(week * (seasonDays / 7) + p.collections * config.xp.collection);
    const level = levelFor(season, config.levels);
    const max = config.levels[config.levels.length - 1];
    const daysToMax = season >= max ? Math.ceil((max / season) * seasonDays) : null;
    const reached = config.rewards.filter((r) => r.level <= level);
    const credits = reached.reduce((s, r) => s + (r.reward.credits ?? 0), 0);
    const packs = reached.reduce((s, r) => s + (r.reward.packCount ?? 0), 0);
    const packValue = reached.reduce((s, r) => s + (r.reward.packCount ?? 0) * (r.reward.packId ? priceOf(r.reward.packId) ?? 0 : 0), 0);
    return {
      id: p.id, label: p.label, xpPerDay: Math.round(week / 7), xpPerWeek: Math.round(week), xpSeason: season, levelAtEnd: level, daysToMax,
      credits, packs, packValue, badges: reached.filter((r) => r.reward.badge).length,
    };
  });
}
