/**
 * CARD QUALITY (Collection Fase 1/7).
 *
 * Calidad DERIVADA de una instancia (no es un campo persistido nuevo): las cartas serializadas valen
 * más cuanto MENOR es su número de serie; las no serializadas son "standard". Puro y determinista.
 */
import type { VariantDef, QualityGrade } from "./types";

/** Grado de calidad de una instancia según su nº de serie relativo al límite de la tirada. */
export function qualityOf(variant: VariantDef, serial: number | null | undefined): QualityGrade {
  if (!variant.serialized || serial == null || !variant.serialLimit) return "standard";
  if (serial === 1) return "gem";                              // #1 de la tirada
  const pct = serial / variant.serialLimit;                   // 0..1 (menor = mejor)
  if (pct <= 0.02) return "mint";
  if (pct <= 0.10) return "pristine";
  if (pct <= 0.35) return "fine";
  return "standard";
}

/** Peso numérico de un grado (para ordenar por calidad). */
export const QUALITY_RANK: Record<QualityGrade, number> = { standard: 0, fine: 1, pristine: 2, mint: 3, gem: 4 };
