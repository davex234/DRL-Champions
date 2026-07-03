/**
 * BUY PHASE × PLAYER IDENTITY — el temperamento de compra EMERGE del ADN.
 *
 * Disciplina → compra equilibrada (guarda reserva). Agresividad/ego → invierte más
 * (gasta más hondo). Creatividad → mayor variabilidad (picks menos convencionales).
 * Solo LEE la identidad; no modifica el Identity Engine.
 */
import type { Identity } from "@/sim";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const unit = (t: number) => (Math.max(0, Math.min(100, t)) - 50) / 50;

export interface BuyTemperament {
  /** -1..1: cuánto invierte (gasta más hondo). */
  invest: number;
  /** 0..0.4: fracción de créditos que tiende a guardar. */
  reserveFactor: number;
  /** 0..1: variabilidad de los picks (off-meta). */
  variability: number;
}

export function playerBuyTemperament(id: Identity): BuyTemperament {
  return {
    invest: clamp(unit(id.aggression) * 0.4 + unit(id.ego) * 0.4 + unit(id.riskAppetite) * 0.3 - unit(id.discipline) * 0.2, -1, 1),
    reserveFactor: clamp(0.18 + unit(id.discipline) * 0.15 - unit(id.ego) * 0.1, 0, 0.4),
    variability: clamp(0.1 + unit(id.creativity) * 0.5, 0, 1),
  };
}
