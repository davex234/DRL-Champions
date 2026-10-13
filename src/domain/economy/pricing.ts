import type { CardDef } from "../cards/types";
import { getVariant } from "../cards/variants";
import { packCardClass, type PackCardClass } from "../packs/packClass";

/**
 * Economía de DRL Champions. La moneda es "DRL Credits".
 * El valor de mercado depende del OVR, de la CLASE de la carta (`packCardClass`, F57.3) y, en
 * cartas serializadas, del número de serie (los números bajos valen más).
 *
 * ─────────────────────────── FASE 57.5 — LA FÓRMULA ───────────────────────────
 *
 *   marketValue = redondeo( 50 × MULT[clase] × 1,13^(OVR − 70) )
 *   MULT: Base 1 · Plata 1 · Oro 1 · Masters 4 · Champions 10 · Prime 18 · Icon 25
 *
 * Antes era `50 × 1,45^(rank − 1) × 1,06^(OVR − 60)`: mandaba el rank de la edición, y como champions-s (rank 10) está
 * por encima de future-star (rank 7), la clase Champions valía ×2,7 lo que Prime. Ahora la jerarquía económica es la
 * de producto (Base < Plata < Oro < Masters < Champions < Prime < Icon) y el OVR pesa MÁS (1,13 por punto): cada salto
 * de clase del tramo alto es menor que 8 puntos de OVR, así que una carta mucho mejor puede superar a una de clase
 * superior (Masters 95 > Champions 87, Champions 95 > Prime 87, Prime 95 > Icon 92). Auditoría:
 * `docs/product/fase-57-5-card-value-audit.md`.
 *
 * Base, Plata y Oro son la misma edición con el mismo multiplicador: entre ellas manda solo el OVR, sin saltos en los
 * cortes 81→82 ni 85→86. Una carta `base` con un OVR fuera de 70–92 (p. ej. creada en el admin) usa también el 1.
 */

export const VALUE_SCALE = 50;
export const VALUE_GROWTH = 1.13;
export const VALUE_OVR_ORIGIN = 70;

/** Multiplicador económico de cada clase de carta. */
export const VALUE_CLASS_MULT: Readonly<Record<PackCardClass, number>> = {
  base: 1, plata: 1, oro: 1, masters: 4, champions: 10, prime: 18, icon: 25,
};

/**
 * Redondeo «de videojuego» según la escala: a 1 por debajo de 50, a 5 hasta 100, a 10 hasta 1.000, a 50 hasta 10.000 y
 * a 100 por encima. El paso relativo (≤ 10 %) es menor que el crecimiento por punto de OVR (13 %), así que el valor sube
 * ESTRICTAMENTE con el OVR dentro de cada clase. Nunca devuelve menos que su paso (sin 0 ni negativos).
 */
export function gameRound(raw: number): number {
  const step = raw < 50 ? 1 : raw < 100 ? 5 : raw < 1_000 ? 10 : raw < 10_000 ? 50 : 100;
  return Math.max(step, Math.round(raw / step) * step);
}

/** Valor de una clase y un OVR (admite OVR hipotéticos: curvas, fichas, análisis). */
export function classValue(cls: PackCardClass, ovr: number): number {
  return gameRound(VALUE_SCALE * VALUE_CLASS_MULT[cls] * Math.pow(VALUE_GROWTH, ovr - VALUE_OVR_ORIGIN));
}

/** Clase económica de una carta: la de `packCardClass`, y la edición base fuera de 70–92 cuenta como Base. */
export function valueClass(card: Pick<CardDef, "variantId" | "ovr">): PackCardClass | null {
  return packCardClass(card) ?? (card.variantId === "base" ? "base" : null);
}

/**
 * Tasación HEREDADA por rank de variante, solo para variantes fuera del catálogo diseñado (bronze, regionales, winner,
 * MVP…: ninguna de las 331 cartas). Es la fórmula anterior a F57.5; ninguna carta con clase pasa por aquí.
 */
export function legacyRankValue(card: Pick<CardDef, "variantId" | "ovr">): number {
  const raw = 50 * Math.pow(1.45, getVariant(card.variantId).rank - 1) * Math.pow(1.06, card.ovr - 60);
  return Math.max(25, Math.round(raw / 25) * 25);
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
export function marketValue(card: Pick<CardDef, "variantId" | "ovr">): number {
  const cls = valueClass(card);
  return cls ? classValue(cls, card.ovr) : legacyRankValue(card);
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

/*
 * FASE 57.6 — ya no existe una «venta rápida» al 80 % del valor. Era la vía del modo local sin cuenta y de la receta de
 * reciclaje de la Forja, y convertía abrir sobres en beneficio (la línea principal devuelve ~5× su precio en valor).
 * Destruir una carta a cambio de créditos es UNA sola operación en todo el juego: `salvageValue` (domain/economy/salvage).
 */
