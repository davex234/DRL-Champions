import type { CardDef } from "../cards/types";
import { getVariant } from "../cards/variants";

/**
 * Economía de DRL Champions. La moneda es "DRL Credits".
 * El valor de mercado depende del OVR, de la rareza de la variante y, en
 * cartas serializadas, del número de serie (los números bajos valen más).
 */

/** Porcentaje del valor de mercado que paga la venta rápida. */
export const QUICK_SELL_RATE = 0.8;

/** Multiplicador de valor por rank de variante (rareza). */
function rankMultiplier(rank: number): number {
  // Crecimiento exponencial suave: bronce ~1x, icon/HOF ~muy alto.
  return Math.pow(1.45, rank - 1);
}

/** Multiplicador por OVR (un 90+ vale mucho más que un 70). */
function ovrMultiplier(ovr: number): number {
  return Math.pow(1.06, ovr - 60);
}

/**
 * Multiplicador por número de serie: los números bajos valen mucho más.
 * #1 ≈ 5× el valor de la última serie; decae suavemente hacia los altos.
 * (p. ej. Champions MVP: #1 ≫ #10 ≫ #50 ≫ #100). Curva ajustable.
 */
export function serialMultiplier(serial: number, limit: number): number {
  if (!serial || !limit || limit <= 1) return 1;
  const position = (serial - 1) / (limit - 1); // 0 = el mejor (#1), 1 = el último
  return 1 + 4 * Math.pow(1 - position, 2.6);
}

/** Valor de mercado base de una definición de carta (sin nº de serie). */
export function marketValue(card: CardDef): number {
  const variant = getVariant(card.variantId);
  const raw = 50 * rankMultiplier(variant.rank) * ovrMultiplier(card.ovr);
  // Redondeo a la "decena bonita" para que los precios se sientan de juego.
  return Math.max(25, Math.round(raw / 25) * 25);
}

/** Valor de mercado de una instancia concreta (incluye nº de serie). */
export function instanceValue(card: CardDef, serial?: number): number {
  const base = marketValue(card);
  const variant = getVariant(card.variantId);
  if (serial && variant.serialLimit) {
    return Math.round((base * serialMultiplier(serial, variant.serialLimit)) / 25) * 25;
  }
  return base;
}

/** Precio de venta rápida (lo que paga el juego). */
export function quickSellValue(card: CardDef, serial?: number): number {
  return Math.round((instanceValue(card, serial) * QUICK_SELL_RATE) / 5) * 5;
}
