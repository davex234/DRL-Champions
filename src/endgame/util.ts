/**
 * ENDGAME — utilidades compartidas (Career Fase 7/7).
 * Resuelve el club del entrenador y localiza datos del mundo. PURO.
 */
import type { ManagerCareer } from "@/career";
import type { WorldState } from "@/world";

/** Id del club del entrenador (actual o, si está retirado, el último que dirigió). */
export function clubIdOf(career: ManagerCareer, world: WorldState): string | null {
  if (career.clubId && world.teams[career.clubId]) return career.clubId;
  const lastSpell = career.history.spells[career.history.spells.length - 1];
  if (lastSpell) { const t = Object.values(world.teams).find((x) => x.name === lastSpell.team); if (t) return t.id; }
  if (career.currentTeam) { const t = Object.values(world.teams).find((x) => x.name === career.currentTeam); if (t) return t.id; }
  return null;
}

export const pct = (n: number, d: number): number => (d <= 0 ? 0 : Math.round((n / d) * 100));
