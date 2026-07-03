/** Tipos del mercado de transferencias de DRL Champions. */
import type { OwnedCard } from "@/domain/cards/types";

export type SellerKind = "bot" | "user";

// ── Marketplace Engine (Collection Fase 5/7) — campos AÑADIDOS, todos OPCIONALES (compat UI) ──
export type ListingStatus = "active" | "sold" | "cancelled" | "expired" | "reserved";
export type Visibility = "public" | "private";

/** Una carta publicada a la venta en el mercado. */
export interface MarketListing {
  id: string;
  cardId: string;
  serial?: number;
  price: number;
  seller: SellerKind;
  listedAt: number; // epoch ms

  // ── Fase 5/7 ──
  status?: ListingStatus;          // por defecto "active"
  visibility?: Visibility;         // por defecto "public"
  /** Vendedor concreto ("user" o id de bot) para multi-vendedor/analytics. */
  sellerId?: string;
  /** Caducidad (epoch ms). Si se supera, expira y devuelve la carta. */
  expiresAt?: number;
  /** Venta privada/reservada: solo este comprador puede adquirirla. */
  reservedFor?: string;
  /** Lote: agrupa varias cartas en una sola operación. */
  lotId?: string;
  /**
   * Instancia REAL escrowada (la carta del usuario retirada de la colección mientras está listada).
   * La propiedad sigue siendo de Collection: aquí solo se custodia hasta vender/cancelar/expirar.
   */
  escrow?: OwnedCard;
}

/** Oferta / contraoferta sobre una carta o un listado. */
export type OfferStatus = "pending" | "accepted" | "rejected" | "countered" | "expired" | "cancelled";
export interface MarketOffer {
  id: string;
  /** Oferta sobre un listado concreto (o null: oferta abierta por una carta). */
  listingId?: string;
  cardId: string;
  serial?: number;
  amount: number;
  /** Quién oferta ("user" o id de bot). */
  from: string;
  status: OfferStatus;
  createdAt: number;
  expiresAt?: number;
  /** Importe de la contraoferta (si status = "countered"). */
  counterAmount?: number;
}

/** Eventos del mercado (superset de Collection Events). */
export type MarketEventType =
  | "listing_created" | "listing_removed" | "listing_expired" | "listing_sold"
  | "offer_created" | "offer_rejected" | "offer_accepted" | "trade_completed"
  | "price_changed" | "market_record";

export interface MarketEvent {
  type: MarketEventType;
  at: number;
  cardId?: string;
  listingId?: string;
  offerId?: string;
  data?: unknown;
}

/** Tendencia de precio reciente. */
export type Trend = "up" | "down" | "stable";

/** Registro histórico de precios de una carta concreta. */
export interface PriceRecord {
  /** Precio de la última venta. */
  lastSale: number;
  /** Precio medio de las ventas recientes. */
  avg: number;
  /** Precio mínimo registrado. */
  min: number;
  /** Precio máximo registrado. */
  max: number;
  /** Ventas recientes (la más reciente al final), limitadas. */
  recent: { price: number; at: number }[];
}

/** Registro de una transacción del usuario (compra o venta). */
export interface TxRecord {
  cardId: string;
  serial?: number;
  price: number;
  at: number;
}
