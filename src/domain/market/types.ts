/** Tipos del mercado de transferencias de DRL Champions. */

export type SellerKind = "bot" | "user";

/** Una carta publicada a la venta en el mercado. */
export interface MarketListing {
  id: string;
  cardId: string;
  serial?: number;
  price: number;
  seller: SellerKind;
  listedAt: number; // epoch ms
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
