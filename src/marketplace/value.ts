/**
 * VALOR DINÁMICO (Collection Fase 5/7).
 *
 * El precio NUNCA es fijo. Se compone de motores EXISTENTES (sin inventar economía):
 *   • base: `instanceValue` (rareza + serial + calidad + variante + OVR/palmarés del jugador).
 *   • demanda/tendencia: historial de precios (`PriceRecord`: avg + tendencia reciente).
 *   • oferta: nº de listados activos de la misma carta (más oferta ⇒ menor precio).
 *   • modificadores: temporada / evento / popularidad (Living World / Career). Multiplicadores.
 * Puro y determinista. Sin `Math.random`/`Date.now`.
 */
import { instanceValue } from "@/domain/economy/pricing";
import { computeTrend } from "@/domain/market/history";
import type { CardDef, ValueContext } from "./types";

const clampMul = (n: number, lo = 0.25, hi = 4): number => Math.max(lo, Math.min(hi, n));

/** Valor JUSTO de una instancia, mezclando base + demanda + oferta + modificadores. */
export function fairValue(card: CardDef, serial: number | undefined, ctx: ValueContext = {}): number {
  const base = instanceValue(card, serial);

  // Demanda: la media de mercado tira del precio (60% base + 40% mercado) + sesgo por tendencia.
  let price = base;
  if (ctx.history && ctx.history.recent.length > 0) {
    const trend = computeTrend(ctx.history);
    const trendMul = trend === "up" ? 1.06 : trend === "down" ? 0.94 : 1;
    price = (0.6 * base + 0.4 * ctx.history.avg) * trendMul;
  }

  // Oferta: cada listado activo adicional presiona el precio a la baja (suave, acotado).
  if (ctx.activeListings && ctx.activeListings > 1) price *= Math.max(0.7, Math.pow(0.97, ctx.activeListings - 1));

  // Modificadores externos (temporada/evento/popularidad/demanda), acotados.
  const m = ctx.modifiers;
  if (m) price *= clampMul((m.season ?? 1) * (m.event ?? 1) * (m.popularity ?? 1) * (m.demand ?? 1));

  return Math.max(25, Math.round(price / 25) * 25);
}

/** Puntuación de chollo del precio de un listado respecto al valor justo (<1 = chollo). */
export function dealRatio(price: number, fair: number): number {
  if (fair <= 0) return 1;
  return Math.round((price / fair) * 100) / 100;
}
