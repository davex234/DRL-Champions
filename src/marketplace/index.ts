/**
 * MARKETPLACE & PLAYER TRADING ENGINE — API pública (Collection Fase 5/7).
 *
 * Motor determinista que ADMINISTRA operaciones de mercado (listados/ofertas/contraofertas/reservas/
 * ventas privadas/lotes/historial/analytics) ENCIMA de Collection, que sigue siendo la ÚNICA dueña de
 * las cartas. Reutiliza `@/domain/market` (tipos/fees/history), pricing y el RNG del proyecto; nunca
 * duplica inventario/catálogo/ownership/economía. NO abre battle pass, presentation ni trading online.
 *
 *   Collection → Marketplace → Collection → Deck → Gameplay → Career
 */
export * from "./types";
export { MarketEngine } from "./engine";
export { fairValue, dealRatio } from "./value";
export { migrateMarketState } from "./migrate";
export { ev } from "./events";
// Re-exporta la economía de mercado existente (fuente única; sin duplicar).
export { applyTax, taxPercent, dealScore, bandLimits, withinBand, DEFAULT_TAX_BPS } from "@/domain/market/fees";
export { emptyRecord, pushSale, computeTrend, TREND_META } from "@/domain/market/history";
