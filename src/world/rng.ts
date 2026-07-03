/**
 * RNG DETERMINISTA del mundo (mulberry32). Sin `Date`/`Math.random`: el universo entero
 * es reproducible a partir de la semilla del mundo + temporada + clave. Puro.
 */
export interface Rng { next(): number; int(maxExclusive: number): number; pick<T>(xs: T[]): T; chance(p: number): boolean }

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (m) => Math.floor(next() * Math.max(1, m)),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    chance: (p) => next() < p,
  };
}

/** Hash FNV-1a estable: deriva una semilla reproducible de varias claves. */
export function seedOf(...parts: (string | number)[]): number {
  let h = 2166136261 >>> 0;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
