/** Tipos de filas de las tablas del sistema de torneos (0006_tournaments.sql). */

export interface TournamentRow {
  id: string;
  name: string;
  region: string | null;
  tier: string | null;
  status: string;
  event_id: string | null;
  winner_team_id: string | null;
  start_date: string | null;
  end_date: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TournamentTeamRow {
  id: string;
  tournament_id: string;
  team_id: string;
  team_name: string | null;
  placement: number | null;
  status: string;
  eliminated_at: string | null;
  created_at: string;
}

export interface TournamentPlayerRow {
  id: string;
  tournament_id: string;
  team_id: string | null;
  player_id: string;
  nick: string | null;
  rating: number | null;
  acs: number | null;
  kd: number | null;
  kast: number | null;
  maps: number | null;
  is_mvp: boolean;
  stats: Record<string, unknown>;
  created_at: string;
}

export interface CardGenerationRuleRow {
  id: string;
  kind: string;
  tier: string;
  label: string;
  min_rating: number | null;
  accolade: string | null;
  color: string | null;
  priority: number;
  active: boolean;
  updated_at: string;
}

export interface CardGenerationRow {
  id: string;
  tournament_id: string;
  trigger: string;
  team_id: string | null;
  cards_generated: number;
  special_generated: number;
  status: string;
  detail: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

export interface CardPhotoRow {
  id: string;
  player_id: string;
  url: string;
  source: string;
  captured_at: string | null;
  quality: number | null;
  approval_status: string;
  priority: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlayerCardRow {
  id: string;
  tournament_id: string;
  player_id: string;
  team_id: string | null;
  rarity_tier: string | null;
  accolade: string | null;
  variant_id: string;
  card_id: string;
  ovr: number | null;
  rating: number | null;
  stats: Record<string, unknown>;
  photo_id: string | null;
  generation_id: string | null;
  created_at: string;
}

export interface SpecialCardRow {
  id: string;
  tournament_id: string;
  kind: string;
  player_id: string;
  team_id: string | null;
  rarity_tier: string | null;
  accolade: string | null;
  variant_id: string;
  card_id: string;
  stats: Record<string, unknown>;
  photo_id: string | null;
  generation_id: string | null;
  created_at: string;
}
