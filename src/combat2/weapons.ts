/**
 * COMBAT INTEGRATION — Sistema PROPIO de armas (no copia Valorant).
 *
 * Cada arma aporta características ABSTRACTAS normalizadas (0..1): potencia, precisión,
 * cadencia, fiabilidad, alcance, penalización en movimiento y capacidad de trade. Son
 * MODIFICADORES de comportamiento/resolución, nunca control directo.
 *
 * Independiente: no importa el catálogo de la Buy Phase (solo usa ids). Si un id no
 * existe aquí, se deriva un perfil a partir del firepower del loadout.
 */
import type { SimLoadout } from "../sim";

/** Daño por localización (puntos de HP). Abstracto, sabor Valorant. */
export interface WeaponDamage {
  body: number;
  head: number;
  leg: number;
}

export interface WeaponProfile {
  power: number;
  accuracy: number;
  fireRate: number;
  reliability: number;
  range: number;
  movePenalty: number;
  trade: number;
  // — Combat 3.0 (balística) —
  /** Daño por localización a quemarropa. */
  damage: WeaponDamage;
  /** Distancia normalizada (0..1) a partir de la cual el daño cae (1 = sin falloff). */
  falloffStart: number;
  /** Capacidad de atravesar paredes (0..1). */
  penetration: number;
  /** Proyectiles por disparo (escopetas > 1; el daño listado ya es agregado a bocajarro). */
  pellets: number;
  /** Control del retroceso (0..1): alto = el spray mantiene precisión. */
  control: number;
  /** Disparos por tick típicos (1 = tap/sniper, 2-3 = automático). */
   shots: number;
}

/** Perfiles por id (mismo id que el catálogo de compra, sistema de stats propio). */
export const WEAPON_PROFILES: Record<string, WeaponProfile> = {
  classic:  { power: 0.25, accuracy: 0.55, fireRate: 0.50, reliability: 0.60, range: 0.40, movePenalty: 0.15, trade: 0.40, damage: { body: 26, head: 78, leg: 22 }, falloffStart: 0.4, penetration: 0.30, pellets: 1, control: 0.55, shots: 1 },
  ghost:    { power: 0.38, accuracy: 0.70, fireRate: 0.55, reliability: 0.70, range: 0.55, movePenalty: 0.15, trade: 0.45, damage: { body: 30, head: 105, leg: 25 }, falloffStart: 0.5, penetration: 0.55, pellets: 1, control: 0.62, shots: 1 },
  frenzy:   { power: 0.34, accuracy: 0.48, fireRate: 0.80, reliability: 0.55, range: 0.30, movePenalty: 0.12, trade: 0.55, damage: { body: 26, head: 63, leg: 22 }, falloffStart: 0.3, penetration: 0.30, pellets: 1, control: 0.40, shots: 2 },
  sheriff:  { power: 0.60, accuracy: 0.55, fireRate: 0.35, reliability: 0.50, range: 0.60, movePenalty: 0.20, trade: 0.35, damage: { body: 55, head: 159, leg: 46 }, falloffStart: 0.5, penetration: 0.60, pellets: 1, control: 0.50, shots: 1 },
  stinger:  { power: 0.50, accuracy: 0.52, fireRate: 0.90, reliability: 0.55, range: 0.30, movePenalty: 0.10, trade: 0.68, damage: { body: 27, head: 67, leg: 23 }, falloffStart: 0.25, penetration: 0.30, pellets: 1, control: 0.38, shots: 3 },
  spectre:  { power: 0.55, accuracy: 0.60, fireRate: 0.85, reliability: 0.65, range: 0.35, movePenalty: 0.10, trade: 0.70, damage: { body: 26, head: 78, leg: 22 }, falloffStart: 0.35, penetration: 0.35, pellets: 1, control: 0.55, shots: 3 },
  bucky:    { power: 0.70, accuracy: 0.40, fireRate: 0.30, reliability: 0.45, range: 0.15, movePenalty: 0.10, trade: 0.30, damage: { body: 44, head: 88, leg: 37 }, falloffStart: 0.12, penetration: 0.10, pellets: 5, control: 0.45, shots: 1 },
  judge:    { power: 0.72, accuracy: 0.45, fireRate: 0.80, reliability: 0.50, range: 0.20, movePenalty: 0.10, trade: 0.60, damage: { body: 40, head: 80, leg: 34 }, falloffStart: 0.15, penetration: 0.10, pellets: 5, control: 0.40, shots: 2 },
  bulldog:  { power: 0.70, accuracy: 0.68, fireRate: 0.70, reliability: 0.68, range: 0.70, movePenalty: 0.35, trade: 0.60, damage: { body: 35, head: 115, leg: 29 }, falloffStart: 0.6, penetration: 0.60, pellets: 1, control: 0.62, shots: 2 },
  guardian: { power: 0.80, accuracy: 0.80, fireRate: 0.45, reliability: 0.80, range: 0.80, movePenalty: 0.40, trade: 0.45, damage: { body: 65, head: 195, leg: 49 }, falloffStart: 0.8, penetration: 0.70, pellets: 1, control: 0.70, shots: 1 },
  phantom:  { power: 0.85, accuracy: 0.82, fireRate: 0.82, reliability: 0.82, range: 0.75, movePenalty: 0.40, trade: 0.70, damage: { body: 39, head: 156, leg: 33 }, falloffStart: 0.5, penetration: 0.60, pellets: 1, control: 0.78, shots: 2 },
  vandal:   { power: 0.90, accuracy: 0.80, fireRate: 0.80, reliability: 0.78, range: 0.85, movePenalty: 0.40, trade: 0.70, damage: { body: 40, head: 160, leg: 34 }, falloffStart: 1.0, penetration: 0.70, pellets: 1, control: 0.72, shots: 2 },
  marshal:  { power: 0.78, accuracy: 0.88, fireRate: 0.30, reliability: 0.80, range: 0.92, movePenalty: 0.55, trade: 0.30, damage: { body: 101, head: 202, leg: 86 }, falloffStart: 1.0, penetration: 0.70, pellets: 1, control: 0.80, shots: 1 },
  operator: { power: 1.00, accuracy: 0.90, fireRate: 0.20, reliability: 0.85, range: 1.00, movePenalty: 0.70, trade: 0.25, damage: { body: 150, head: 255, leg: 120 }, falloffStart: 1.0, penetration: 0.80, pellets: 1, control: 0.85, shots: 1 },
};

/** Perfil de respaldo a partir del firepower (si el arma no está catalogada aquí). */
function fallbackProfile(firepower: number): WeaponProfile {
  const p = Math.max(0, Math.min(1, firepower / 100));
  const body = Math.round(22 + p * 28);
  return { power: p, accuracy: 0.6, fireRate: 0.5, reliability: 0.6, range: 0.5, movePenalty: 0.3, trade: 0.5, damage: { body, head: Math.round(body * 2.7), leg: Math.round(body * 0.85) }, falloffStart: 0.6, penetration: 0.5, pellets: 1, control: 0.6, shots: p > 0.6 ? 2 : 1 };
}

/** Perfil del arma EN USO de un loadout (principal si hay, si no la secundaria). */
export function profileFor(loadout: SimLoadout): WeaponProfile {
  const id = loadout.primary ?? loadout.sidearm;
  return WEAPON_PROFILES[id] ?? fallbackProfile(loadout.firepower);
}

/**
 * Valor de combate efectivo del arma a una distancia normalizada (0..1) y según si el
 * jugador se mueve. Las armas de largo alcance conservan valor a distancia; las de
 * corto lo pierden. Moverse penaliza según `movePenalty`.
 */
export function effectiveValue(w: WeaponProfile, distance: number, moving: boolean): number {
  const rangeFactor = w.range + (1 - distance) * (1 - w.range);
  let v = w.power * (0.55 + 0.45 * w.accuracy) * rangeFactor;
  if (moving) v *= 1 - w.movePenalty * 0.4;
  return v;
}
