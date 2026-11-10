/** Tipos de filas del Collection Engine (0008_collections.sql). */

export interface CollectionRow {
  id: string;
  tournament_id: string | null;
  slug: string;
  name: string;
  tier: string | null;
  region: string | null;
  reward: Record<string, unknown>;
  total_items: number;
  created_at: string;
  updated_at: string;
}

export interface CollectionItemRow {
  id: string;
  collection_id: string;
  card_id: string;
  player_id: string | null;
  category: string;
  label: string | null;
  accolade: string | null;
  variant_id: string | null;
  ovr: number | null;
  created_at: string;
}
