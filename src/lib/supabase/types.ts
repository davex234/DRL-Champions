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
