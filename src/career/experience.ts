/**
 * MANAGER CAREER ENGINE — experiencia y nivel.
 *
 * El entrenador APRENDE: gana XP por resultados (no por tiempo) y sube de nivel. El nivel
 * es una métrica de carrera (distinta del nivel de cuenta del coleccionista). Puro.
 */
import type { MatchOutcome, SeasonOutcome } from "./types";

/** XP requerida para alcanzar el nivel N (curva suave, techo alto para décadas). */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  // Crecimiento cuadrático moderado: nivel 10 ≈ 4.500, nivel 50 ≈ 122k, nivel 70 ≈ 241k.
  return Math.round(50 * (level - 1) * (level - 1) + 200 * (level - 1));
}

/** Nivel de carrera a partir de la XP acumulada. */
export function levelFromXp(xp: number): number {
  let level = 1;
  while (level < 99 && xpForLevel(level + 1) <= xp) level++;
  return level;
}

/** Progreso 0..1 dentro del nivel actual (para barras de la UI). */
export function levelProgress(xp: number): { level: number; progress: number; toNext: number } {
  const level = levelFromXp(xp);
  const cur = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const span = Math.max(1, next - cur);
  return { level, progress: Math.max(0, Math.min(1, (xp - cur) / span)), toNext: Math.max(0, next - xp) };
}

const TIER_MULT = { regional: 1, continental: 1.6, global: 2.4 } as const;

/** XP de un partido: base por jugar, bonus por ganar/kills/MVP, escalada por importancia. */
export function xpForMatch(o: MatchOutcome): number {
  const tier = TIER_MULT[o.tier ?? "regional"];
  let xp = 12 + (o.won ? 28 : 6) + Math.min(20, (o.kills ?? 0)) + (o.mvp ? 15 : 0);
  return Math.round(xp * tier);
}

/** XP de una temporada/competición: gran salto por título, escalada por importancia. */
export function xpForSeason(o: SeasonOutcome): number {
  const tier = TIER_MULT[o.tier];
  let xp = 120 + o.wins * 18;
  if (o.champion) xp += 900;
  else if (o.finalist) xp += 350;
  if (o.mvpAwarded) xp += 150;
  // Mejor clasificación = más XP (placement 1 es el máximo).
  xp += Math.max(0, 200 - (o.placement - 1) * 40);
  return Math.round(xp * tier);
}
