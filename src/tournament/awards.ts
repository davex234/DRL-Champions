/**
 * AWARDS / CIRCUIT POINTS / RECORDS (Online Fase 6/7). PURO. Determinista.
 */
import type { TournamentTier } from "./types";

const TIER_BASE: Record<TournamentTier, number> = { regional: 100, minor: 150, major: 300, worlds: 500, season_finals: 400 };

/** Puntos de circuito por posición final (mayor tier + mejor puesto = más puntos). */
export function circuitPointsFor(tier: TournamentTier, placement: number, fieldSize: number): number {
  const base = TIER_BASE[tier];
  const frac = Math.max(0, 1 - (placement - 1) / Math.max(1, fieldSize));
  const bonus = placement === 1 ? 1.5 : placement === 2 ? 1.15 : placement <= 4 ? 1.0 : 0.8;
  return Math.round(base * frac * bonus);
}
