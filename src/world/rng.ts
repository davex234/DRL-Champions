/**
 * RNG del mundo — ADAPTADOR sobre el RNG único del proyecto (Consolidation F1.1).
 *
 * Antes este archivo duplicaba mulberry32 con una interfaz incompatible (`int(maxExclusive)`
 * de 1 argumento vs `int(min,max)` del sim): misma firma nominal, semántica distinta — bomba
 * de relojería. Ahora delega en `@/sim/rng` (fuente única del algoritmo) conservando la
 * interfaz histórica del mundo Y la secuencia EXACTA (cada operación consume un único
 * `next()` con la misma fórmula), de modo que los mundos generados no cambian.
 */
import { makeRng as makeBaseRng, seedFrom } from "@/sim/rng";

export interface Rng { next(): number; int(maxExclusive: number): number; pick<T>(xs: T[]): T; chance(p: number): boolean }

export function makeRng(seed: number): Rng {
  const base = makeBaseRng(seed);
  return {
    next: base.next,
    // NB: se implementa sobre next() (no base.int) para preservar el stream y el clamp max(1,m).
    int: (m) => Math.floor(base.next() * Math.max(1, m)),
    pick: (xs) => base.pick(xs),
    chance: (p) => base.chance(p),
  };
}

/** Hash FNV-1a estable: deriva una semilla reproducible de varias claves (= seedFrom del sim). */
export function seedOf(...parts: (string | number)[]): number {
  return seedFrom(parts.join("|"));
}
