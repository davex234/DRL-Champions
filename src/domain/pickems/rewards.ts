/**
 * RECOMPENSAS DE PICK'EMS (bloque H) — configuración por DATOS, no por código.
 *
 * Reutiliza el tipo `Reward` que ya usan eventos, battle pass y colecciones
 * (`domain/events/types`), para no inventar una segunda moneda de cambio.
 *
 * Añadir un escalón o cambiar un premio = tocar `REWARD_TIERS`. Ningún componente
 * ni ninguna ruta contiene la regla, así que un torneo nuevo no exige tocar la UI.
 */
import type { Reward } from "@/domain/events/types";

export interface RewardTier {
  id: string;
  /** Puntos mínimos conseguidos en el Pick'em para alcanzar este escalón. */
  minPoints: number;
  label: string;
  reward: Reward;
}

/**
 * Escalones, de menor a mayor. Se concede EL MÁS ALTO alcanzado, no la suma:
 * así subir de escalón siempre mejora y nunca hay que reconciliar acumulados.
 */
export const REWARD_TIERS: RewardTier[] = [
  { id: "participacion", minPoints: 1,  label: "Participación", reward: { credits: 500,  xp: 50} },
  { id: "acertante",     minPoints: 20, label: "Acertante",     reward: { credits: 1500, xp: 150, packId: "estandar", packCount: 1 } },
  { id: "analista",      minPoints: 50, label: "Analista",      reward: { credits: 3000, xp: 300, packId: "premium",  packCount: 1 } },
  { id: "oraculo",       minPoints: 90, label: "Oráculo",       reward: { credits: 6000, xp: 600, packId: "champions", packCount: 1 } },
];

/** Escalón alcanzado con esos puntos, o `null` si no llega ni al primero. */
export function tierForPoints(points: number): RewardTier | null {
  const p = Number.isFinite(points) ? Math.floor(points) : 0;
  let best: RewardTier | null = null;
  for (const t of REWARD_TIERS) if (p >= t.minPoints) best = t;
  return best;
}

/** Recompensa que corresponde a esos puntos (vacía si no alcanza ningún escalón). */
export function rewardForPoints(points: number): Reward {
  return tierForPoints(points)?.reward ?? {};
}

/** Puntos máximos posibles de un Pick'em, para mostrar "X de Y". */
export function maxPoints(questionPoints: number[]): number {
  return questionPoints.reduce((s, p) => s + (Number.isFinite(p) ? Math.max(0, p) : 0), 0);
}
