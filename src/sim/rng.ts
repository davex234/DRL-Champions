/**
 * RNG sembrado (mulberry32). TODO el azar de la simulación pasa por aquí: mismo
 * `seed` ⇒ misma ronda, byte a byte (determinismo → repeticiones y tests fiables).
 * Puro, sin estado global.
 */
export interface Rng {
  /** Flotante en [0,1). */
  next(): number;
  /** Entero en [min, max] inclusive. */
  int(min: number, max: number): number;
  /** true con probabilidad p. */
  chance(p: number): boolean;
  /** Elige un elemento (no vacío). */
  pick<T>(arr: readonly T[]): T;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

/** Semilla a partir de un texto (estable). */
export function seedFrom(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
