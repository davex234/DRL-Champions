/**
 * CLOCK — reloj 100% inyectable. El módulo JAMÁS consulta el reloj del sistema: quien lo usa
 * decide el tiempo (los verifies inyectan relojes fijos/avanzables; la CLI pasa el suyo).
 */
import type { SchedulerClock } from "./types";

/** Reloj fijo (tests/verifies). */
export const fixedClock = (at: number): SchedulerClock => () => at;

/** Reloj lógico avanzable manualmente. */
export function steppableClock(start: number): SchedulerClock & { advance: (ms: number) => void } {
  let now = start;
  const clock = (() => now) as SchedulerClock & { advance: (ms: number) => void };
  clock.advance = (ms: number) => { now += ms; };
  return clock;
}
