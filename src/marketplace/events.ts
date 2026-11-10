/**
 * EVENTOS DEL MERCADO (Collection Fase 5/7). Fábrica ligera y determinista.
 */
import type { MarketEvent, MarketEventType } from "./types";

export function ev(type: MarketEventType, at: number, extra: Partial<MarketEvent> = {}): MarketEvent {
  return { type, at, ...extra };
}
