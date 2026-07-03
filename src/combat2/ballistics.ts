/**
 * COMBAT 3.0 · BALÍSTICA — daño de un IMPACTO. PURO y determinista.
 *
 * Traduce (arma + localización + distancia + escudo + penetración) → daño aplicado, repartido
 * entre escudo (absorbido) y vida. Reutiliza WEAPON_PROFILES (no crea otro catálogo de armas) y
 * shieldEffect (no crea otro sistema de HP). Sin azar: el azar (impactar / dónde) vive en duel.ts.
 */
import type { WeaponProfile } from "./weapons";

export type HitLocation = "head" | "body" | "leg";

export interface ShotDamage {
  location: HitLocation;
  /** Daño bruto antes de repartir entre escudo/vida. */
  raw: number;
  /** Absorbido por el escudo. */
  toShield: number;
  /** Aplicado a la vida. */
  toHp: number;
  /** ¿Atravesó una pared (wallbang)? Reduce el daño. */
  wallbang: boolean;
}

/** Vida de escudo por tipo de armadura (puntos que absorben antes que la vida). */
export function shieldHp(armor: "none" | "light" | "heavy"): number {
  return armor === "heavy" ? 50 : armor === "light" ? 25 : 0;
}

/** Daño base de una localización, con caída por distancia (normalizada 0..1). */
export function baseDamage(w: WeaponProfile, location: HitLocation, distance: number): number {
  const d = w.damage[location];
  if (distance <= w.falloffStart) return d;
  // Más allá del falloff, cae linealmente hasta ~55% al alcance máximo.
  const over = (distance - w.falloffStart) / Math.max(0.001, 1 - w.falloffStart);
  return d * (1 - 0.45 * Math.min(1, over));
}

/**
 * Resuelve UN impacto: calcula el daño y lo reparte entre escudo y vida. `wallbang` aplica una
 * reducción según la penetración del arma. No muta nada: devuelve el desglose.
 */
export function resolveHit(
  w: WeaponProfile, location: HitLocation, distance: number,
  shield: number, wallbang = false,
): ShotDamage {
  let raw = baseDamage(w, location, distance);
  if (wallbang) raw *= 0.3 + 0.5 * w.penetration; // a través de pared: 0.3..0.8 del daño
  raw = Math.round(raw);
  const toShield = Math.min(shield, raw);
  const toHp = raw - toShield;
  return { location, raw, toShield, toHp, wallbang };
}
