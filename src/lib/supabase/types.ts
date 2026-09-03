/** Tipos de filas de la base de datos (espejo de las tablas SQL). */

export interface Profile {
  id: string;
  username: string;
  avatar: string;
  level: number;
  xp: number;
  credits: number;
  tokens: number;
  collection_value: number;
  distinct_cards: number;
  rarest_rank: number;
  market_volume: number;
  packs_opened: number;
  /** Puntos competitivos de Pick'ems. Solo los escribe el corrector del servidor. */
  points: number;
  /**
   * Región competitiva declarada por el usuario (Fase 9D). `null` = sin declarar:
   * ese jugador cuenta en la clasificación global y no en la regional.
   */
  region: "EMEA" | "Americas" | "Pacific" | "China" | null;
  created_at: string;
  updated_at: string;
}

export interface Listing {
  id: string;
  seller_id: string;
  card_id: string;
  serial: number | null;
  price: number;
  status: "active" | "sold" | "cancelled";
  buyer_id: string | null;
  created_at: string;
  sold_at: string | null;
}

export interface Transaction {
  id: string;
  buyer_id: string;
  seller_id: string;
  card_id: string;
  serial: number | null;
  price: number;
  created_at: string;
}

/* ---- Mercado global avanzado (migración 0004_market.sql) ---- */

export type OfferKind = "listing" | "card";
export type OfferStatus = "active" | "accepted" | "rejected" | "cancelled" | "expired";

export interface Offer {
  id: string;
  kind: OfferKind;
  buyer_id: string;
  card_id: string;
  serial: number | null;
  listing_id: string | null;
  price: number;
  status: OfferStatus;
  created_at: string;
  resolved_at: string | null;
  expires_at: string | null;
}

export interface CardPriceStats {
  card_id: string;
  last_price: number | null;
  avg_price: number | null;
  min_price: number | null;
  max_price: number | null;
  trade_count: number;
  volume: number;
  last_sale_at: string | null;
  updated_at: string;
}

/** Vela diaria de precio (serie temporal para gráficas). */
export interface CardPriceDaily {
  card_id: string;
  day: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

export interface MarketConfig {
  id: string;
  tax_bps: number;
  min_price: number;
  min_price_mult: number;
  max_price_mult: number;
  max_listings_per_hour: number;
  max_buys_per_hour: number;
  resale_cooldown_secs: number;
  wash_window_secs: number;
  wash_max_pair: number;
  total_burned: number;
}

export interface CardReference {
  card_id: string;
  player_id: string | null;
  nick: string | null;
  team: string | null;
  region: string | null;
  rank: number | null;
  ovr: number | null;
  fair_value: number | null;
}

/** Fila devuelta por la RPC `search_listings`. */
export interface ListingSearchRow {
  id: string;
  card_id: string;
  serial: number | null;
  price: number;
  seller_id: string;
  created_at: string;
  nick: string | null;
  team: string | null;
  region: string | null;
  rank: number | null;
  ovr: number | null;
  fair_value: number | null;
  /** price / fair_value (chollo si < 1). */
  deal: number | null;
}

/** Fila de la vista `v_market_top_cards` (ranking de cartas más valiosas). */
export interface TopCardRow {
  card_id: string;
  nick: string | null;
  team: string | null;
  region: string | null;
  rank: number | null;
  ovr: number | null;
  fair_value: number | null;
  last_price: number | null;
  avg_price: number | null;
  max_price: number | null;
  trade_count: number | null;
  volume: number | null;
  value: number | null;
  cheapest_active: number | null;
}

/** Fila de la vista `v_market_rarity_stats`. */
export interface RarityStatRow {
  rank: number;
  cards: number;
  avg_fair_value: number | null;
  avg_last_price: number | null;
  volume: number;
  trades: number;
}

/** Campos de perfil que el cliente puede sincronizar (derivados del estado local). */
export interface ProfileSyncFields {
  level: number;
  xp: number;
  credits: number;
  tokens: number;
  collection_value: number;
  distinct_cards: number;
  rarest_rank: number;
  packs_opened: number;
}
