/**
 * Lógica pura de comisiones/impuestos del mercado (espejo TS de la SQL de
 * `0004_market.sql`). Sirve para previsualizar el neto en la UI sin red.
 * La fuente de verdad sigue siendo el servidor (las RPC recalculan y cobran).
 */

/** Impuesto por defecto en puntos básicos (5%). El servidor manda el real. */
export const DEFAULT_TAX_BPS = 500;

export interface TaxBreakdown {
  /** Importe bruto (lo que paga el comprador). */
  gross: number;
  /** Impuesto retirado de la economía (sink). */
  tax: number;
  /** Neto que recibe el vendedor. */
  net: number;
}

/** Aplica el impuesto de mercado a un precio de venta. */
export function applyTax(price: number, taxBps: number = DEFAULT_TAX_BPS): TaxBreakdown {
  const gross = Math.max(0, Math.floor(price));
  const tax = Math.floor((gross * taxBps) / 10000);
  return { gross, tax, net: gross - tax };
}

/** Porcentaje de impuesto legible (5 para 5%). */
export function taxPercent(taxBps: number = DEFAULT_TAX_BPS): number {
  return taxBps / 100;
}

/**
 * Puntuación de chollo: precio / valor justo.
 * < 1 ⇒ por debajo del valor (chollo); > 1 ⇒ caro. `null` si no hay ancla.
 */
export function dealScore(price: number, fairValue?: number | null): number | null {
  if (!fairValue || fairValue <= 0) return null;
  return Math.round((price / fairValue) * 100) / 100;
}

export interface BandLimits {
  lo: number;
  hi: number;
}

/** Banda de precio permitida respecto a un ancla (media de mercado o valor justo). */
export function bandLimits(anchor: number, minMult = 0.2, maxMult = 10): BandLimits {
  return { lo: Math.floor(anchor * minMult), hi: Math.ceil(anchor * maxMult) };
}

/** ¿El precio está dentro de la banda permitida para esa ancla? */
export function withinBand(price: number, anchor?: number | null, minMult = 0.2, maxMult = 10): boolean {
  if (!anchor || anchor <= 0) return true;
  const { lo, hi } = bandLimits(anchor, minMult, maxMult);
  return price >= lo && price <= hi;
}
