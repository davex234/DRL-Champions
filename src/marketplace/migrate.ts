/**
 * MIGRACIÓN DEL ESTADO DE MERCADO (Collection Fase 5/7).
 *
 * Normaliza un estado antiguo/corrupto al esquema actual sin romper: sanea arrays, descarta listados
 * inválidos, fija la versión. Determinista.
 */
import { freshMarketState, MARKET_SCHEMA_VERSION, type MarketState, type MarketListing, type MarketOffer } from "./types";

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function migrateMarketState(raw: unknown): MarketState {
  if (!raw || typeof raw !== "object") return freshMarketState();
  const r = raw as Partial<MarketState>;
  const listings = arr<MarketListing>(r.listings).filter((l) => l && typeof l.id === "string" && typeof l.cardId === "string" && Number.isFinite(l.price) && l.price >= 0)
    .map((l) => ({ ...l, status: l.status ?? "active", visibility: l.visibility ?? "public", sellerId: l.sellerId ?? (l.seller === "user" ? "user" : l.id) }));
  const offers = arr<MarketOffer>(r.offers).filter((o) => o && typeof o.id === "string" && typeof o.cardId === "string" && Number.isFinite(o.amount));
  return {
    version: MARKET_SCHEMA_VERSION,
    listings,
    offers,
    priceHistory: r.priceHistory && typeof r.priceHistory === "object" ? r.priceHistory : {},
    transactions: arr(r.transactions),
  };
}
