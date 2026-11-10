/**
 * COMBAT 3.0 · ESTADÍSTICAS de combate por jugador, PERSISTENTES durante la ronda. Las consume
 * el broadcast (ADR/accuracy/HS%) y la narrativa. Datos planos (clonables por structuredClone).
 */
export interface CombatStats {
  damageDealt: number;
  damageTaken: number;
  /** Daño absorbido por el escudo propio. */
  damageAbsorbed: number;
  shotsFired: number;
  shotsHit: number;
  headshots: number;
  bodyshots: number;
  legshots: number;
  kills: number;
  assists: number;
  /** Daño infligido por encima de la vida del rival al matar. */
  overkill: number;
  /** Ticks que el jugador estuvo vivo en la ronda. */
  ticksAlive: number;
}

export function emptyStats(): CombatStats {
  return {
    damageDealt: 0, damageTaken: 0, damageAbsorbed: 0,
    shotsFired: 0, shotsHit: 0, headshots: 0, bodyshots: 0, legshots: 0,
    kills: 0, assists: 0, overkill: 0, ticksAlive: 0,
  };
}

/** Daño medio por ronda (ADR) con `rounds` rondas jugadas. */
export const adr = (s: CombatStats, rounds: number): number => (rounds > 0 ? Math.round(s.damageDealt / rounds) : s.damageDealt);
/** Precisión: impactos / disparos (0..1). */
export const accuracy = (s: CombatStats): number => (s.shotsFired > 0 ? s.shotsHit / s.shotsFired : 0);
/** % de headshots sobre los impactos (0..1). */
export const hsPct = (s: CombatStats): number => (s.shotsHit > 0 ? s.headshots / s.shotsHit : 0);
