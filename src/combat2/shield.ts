/**
 * COMBAT INTEGRATION — Efecto del ESCUDO (más que puntos de vida).
 * Modifica supervivencia (aguanta el duelo), confianza y capacidad de repetir un peek.
 */
import type { SimLoadout } from "../sim";

export interface ShieldEffect {
  /** >1: el portador aguanta mejor el duelo. */
  survival: number;
  /** 0..1: disposición a repetir un peek. */
  repeek: number;
  /** 0..1: bonus de confianza. */
  confidence: number;
}

export function shieldEffect(armor: SimLoadout["armor"]): ShieldEffect {
  switch (armor) {
    case "heavy": return { survival: 1.28, repeek: 0.7, confidence: 0.12 };
    case "light": return { survival: 1.12, repeek: 0.4, confidence: 0.06 };
    default: return { survival: 1.0, repeek: 0.0, confidence: 0.0 };
  }
}
