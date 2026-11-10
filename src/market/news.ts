/**
 * NOTICIAS DE MERCADO — al buzón ÚNICO `useNewsStore` (Career Fase 4/7).
 *
 * Mapea `MarketEvent` → `NewsItem` con `kind:"transfer"` (bombas → "record"), ids DETERMINISTAS
 * para deduplicar. Mismo patrón que `@/world` worldNews y `@/career` careerNews: NO se crea otro
 * feed. El store empuja el resultado con `useNewsStore.getState().add(...)`.
 */
import type { NewsItem, NewsKind } from "@/intel";
import type { MarketEvent, MarketEventType } from "./types";

const KIND: Record<MarketEventType, NewsKind> = {
  signing: "transfer", sale: "transfer", loan_out: "transfer", loan_in: "transfer", loan_return: "transfer",
  renewal: "transfer", release: "transfer", promotion: "transfer", swap: "transfer",
  offer_made: "event", offer_received: "event", offer_rejected: "event", offer_accepted: "transfer",
  counter: "event", bid_rejected: "event", record_signing: "record", bomb: "record",
};

const TITLE: Record<MarketEventType, string> = {
  signing: "Fichaje", sale: "Venta", loan_out: "Cesión", loan_in: "Cesión", loan_return: "Fin de cesión",
  renewal: "Renovación", release: "Baja", promotion: "Ascenso de cantera", swap: "Intercambio",
  offer_made: "Oferta enviada", offer_received: "Oferta recibida", offer_rejected: "Oferta rechazada", offer_accepted: "Acuerdo cerrado",
  counter: "Contraoferta", bid_rejected: "Puja rechazada", record_signing: "Fichaje récord", bomb: "¡Bombazo de mercado!",
};

/** Convierte eventos de mercado en noticias del feed único. `at` lo inyecta el llamador (store). */
export function marketNews(events: MarketEvent[]): NewsItem[] {
  return events.map((e) => ({
    id: `mkt:${e.season}:${e.type}:${e.playerId}:${e.fee}`,
    at: e.at,
    kind: KIND[e.type],
    title: TITLE[e.type],
    body: e.detail,
    player: e.playerNick,
    tags: ["mercado", e.type],
  }));
}
