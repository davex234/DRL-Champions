import type { PlayerStats, StatKey } from "./types";

/**
 * Pesos del cálculo de OVR. Suman 1.0. SCR (puntuación de combate) y DMG
 * son los que más pesan, como en el rendimiento real de un jugador de Valorant.
 */
export const OVR_WEIGHTS: Record<StatKey, number> = {
  scr: 0.25,
  dmg: 0.2,
  com: 0.2,
  clu: 0.15,
  hs: 0.1,
  ast: 0.1,
};

export const STAT_META: Record<StatKey, { label: string; full: string }> = {
  dmg: { label: "DMG", full: "Daño" },
  scr: { label: "SCR", full: "Puntuación" },
  com: { label: "COM", full: "Combate" },
  hs: { label: "HS", full: "Headshots" },
  ast: { label: "AST", full: "Asistencias" },
  clu: { label: "CLU", full: "Clutch" },
};

export const STAT_ORDER: StatKey[] = ["dmg", "scr", "com", "hs", "ast", "clu"];

/**
 * Las 6 estadísticas IMPRESAS en las cartas del catálogo diseñado (Cartas\, 2026-09-21), en el
 * orden en que aparecen en la carta. FKS (primeras bajas) ocupa el sitio de COM.
 */
export const PRINTED_STAT_ORDER: import("./types").PrintedStatKey[] = ["dmg", "scr", "fks", "hs", "ast", "clu"];

export const PRINTED_STAT_META: Record<import("./types").PrintedStatKey, { label: string; full: string }> = {
  dmg: { label: "DMG", full: "Daño" },
  scr: { label: "SCR", full: "Puntuación" },
  fks: { label: "FKS", full: "Primeras bajas" },
  hs: { label: "HS", full: "Headshots" },
  ast: { label: "AST", full: "Asistencias" },
  clu: { label: "CLU", full: "Clutch" },
};

/** Estadísticas que ENSEÑA una carta: las impresas si las tiene, si no las de su jugador. */
export function displayedStats(card: { stats: import("./types").PlayerStats; printed?: { stats: import("./types").PrintedStats } }):
  { key: string; label: string; full: string; value: number }[] {
  if (card.printed) {
    const s = card.printed.stats;
    return PRINTED_STAT_ORDER.map((k) => ({ key: k, ...PRINTED_STAT_META[k], value: s[k] }));
  }
  return STAT_ORDER.map((k) => ({ key: k, ...STAT_META[k], value: card.stats[k] }));
}

const clamp = (n: number) => Math.max(1, Math.min(99, Math.round(n)));

/** Calcula el OVR (1-99) a partir de las 6 estadísticas. */
export function computeOvr(stats: PlayerStats): number {
  let sum = 0;
  for (const key of STAT_ORDER) {
    sum += stats[key] * OVR_WEIGHTS[key];
  }
  return clamp(sum);
}

/** Aplica un bonus uniforme a todas las estadísticas (variantes especiales). */
export function applyStatBoost(stats: PlayerStats, boost: number): PlayerStats {
  if (boost === 0) return { ...stats };
  return {
    dmg: clamp(stats.dmg + boost),
    scr: clamp(stats.scr + boost),
    com: clamp(stats.com + boost),
    hs: clamp(stats.hs + boost),
    ast: clamp(stats.ast + boost),
    clu: clamp(stats.clu + boost),
  };
}
