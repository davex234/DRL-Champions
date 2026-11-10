/**
 * MANAGER CAREER ENGINE — RNG sembrado.
 *
 * REUTILIZA el RNG de la simulación (`@/sim/rng`, mulberry32). Mismo `seed` ⇒ misma
 * carrera, byte a byte. `seedOf` deriva semillas por subsistema/temporada (patrón
 * idéntico al de `@/world`).
 */
import { makeRng, seedFrom, type Rng } from "@/sim/rng";

export { makeRng, seedFrom };
export type { Rng };

/** Semilla estable a partir de varias partes (FNV-1a sobre el join). */
export function seedOf(...parts: (string | number)[]): number {
  return seedFrom(parts.join("|"));
}
