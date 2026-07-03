/**
 * PLAYER IDENTITY ENGINE — Estado mental DINÁMICO.
 *
 * El ADN (traits) es fijo; ESTO evoluciona durante la ronda y entre rondas:
 * confianza, tilt, moral, momentum, fatiga y presión situacional. El ADN decide
 * CÓMO de fuerte y CÓMO de rápido se mueven estas variables (p. ej. `resilience`
 * controla la recuperación; `composure` amortigua el tilt). Puro: opera sobre
 * números, sin RoundState (los disparadores situacionales viven en `modifiers.ts`).
 */
import type { Identity } from "./traits";
import { clampTrait, unit } from "./traits";

export interface MentalState {
  /** Autoconfianza dinámica (0..100). Sube con bajas, baja con muertes propias/aliadas. */
  confidence: number;
  /** Frustración acumulada (0..100). Empeora reacción/puntería; la atenúa `composure`. */
  tilt: number;
  /** Moral del momento (0..100), muy sensible a eventos de equipo. */
  morale: number;
  /** Racha corta (-100..100): caliente (+) o frío (-). */
  momentum: number;
  /** Fatiga (0..100): sube lentamente y se arrastra entre rondas. */
  fatigue: number;
  /** Presión SITUACIONAL (0..100): recalculada cada tick (desventaja, clutch, reloj…). */
  pressure: number;
}

export const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));
const clampSigned = (n: number): number => Math.max(-100, Math.min(100, n));

/** Estado mental inicial derivado del ADN (sin arrastre entre rondas). */
export function initialMental(id: Identity): MentalState {
  return {
    // La confianza arranca cerca del `selfBelief` (con un poco de inercia hacia 50).
    confidence: clampTrait(0.7 * id.selfBelief + 0.3 * 50),
    tilt: 0,
    morale: 55,
    momentum: 0,
    fatigue: 0,
    pressure: 0,
  };
}

/** Arrastre entre rondas: regresa parcialmente a la base; la fatiga persiste y crece. */
export function carryMental(prev: MentalState, id: Identity, won: boolean): MentalState {
  const base = initialMental(id);
  // `resilience` alta = olvida rápido el revés y vuelve a su base.
  const recover = 0.45 + 0.4 * (clampTrait(id.resilience) / 100);
  const blend = (cur: number, b: number) => cur + (b - cur) * recover;
  return {
    confidence: clamp100(blend(prev.confidence, base.confidence) + (won ? 6 : -6)),
    tilt: clamp100(prev.tilt * (1 - recover) + (won ? -4 : 4)),
    morale: clamp100(blend(prev.morale, base.morale) + (won ? 10 : -10)),
    momentum: clampSigned(prev.momentum * 0.5 + (won ? 12 : -12)),
    // La fatiga apenas se recupera entre rondas (acumula a lo largo del mapa).
    fatigue: clamp100(prev.fatigue + 3),
    pressure: 0,
  };
}

/** Decaimiento natural por tick hacia la base (lo llama el motor cada tick). */
export function decayMental(m: MentalState, id: Identity): void {
  const r = clampTrait(id.resilience) / 100;
  // El momentum se enfría siempre; la resiliencia acelera el enfriamiento del frío.
  const cool = 0.02 + 0.03 * r;
  m.momentum += (0 - m.momentum) * (m.momentum < 0 ? cool * 1.5 : cool);
  // El tilt se disuelve lento; la resiliencia ayuda.
  m.tilt = clamp100(m.tilt - (0.04 + 0.12 * r));
  // La confianza deriva suavemente hacia su techo natural (selfBelief).
  const ceil = clampTrait(0.7 * id.selfBelief + 0.3 * 50);
  m.confidence += (ceil - m.confidence) * 0.01;
  // Fatiga: muy lenta dentro de una ronda.
  m.fatigue = clamp100(m.fatigue + 0.004);
  m.confidence = clamp100(m.confidence);
  m.morale = clamp100(m.morale);
  m.momentum = clampSigned(m.momentum);
}

/**
 * Aplica el resultado de una BAJA al estado mental (lo usan los modificadores).
 * `sign` = +1 si es algo bueno para este jugador (mató/su equipo mató),
 *         -1 si es malo (murió un aliado). El propio muerto se congela aparte.
 */
export function bumpFromKill(
  m: MentalState,
  id: Identity,
  sign: number,
  opts: { self: boolean; traded: boolean },
): void {
  const egoK = 1 + unit(id.ego) * 0.5; // el ego amplifica el subidón propio
  const compK = 1 - (clampTrait(id.composure) / 100) * 0.6; // sangre fría amortigua lo malo
  if (sign > 0) {
    const mag = opts.self ? 10 * egoK : 4;
    m.confidence = clamp100(m.confidence + mag);
    m.momentum = clampSigned(m.momentum + (opts.self ? 16 : 7));
    m.morale = clamp100(m.morale + (opts.self ? 5 : 4));
    m.tilt = clamp100(m.tilt - (opts.traded ? 10 : 6));
  } else {
    const mag = (opts.self ? 9 : 5) * compK; // 'self' aquí = se perdió un compañero clave cercano
    m.confidence = clamp100(m.confidence - mag);
    m.momentum = clampSigned(m.momentum - 8 * compK);
    m.morale = clamp100(m.morale - 7);
    m.tilt = clamp100(m.tilt + (opts.traded ? 3 : 8) * compK);
  }
}
