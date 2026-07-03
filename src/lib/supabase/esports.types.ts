/**
 * Tipos de filas (espejo de las tablas SQL del sistema competitivo, 0002+0003).
 * snake_case = exactamente como las devuelve Supabase. La conversión a tipos de
 * dominio (camelCase) vive en `@/lib/esports/repos`.
 */

export interface CircuitRow {
  id: string;
  name: string;
  tier: string;
  region: string | null;
  scope: string;
  parent_circuit_id: string | null;
  logo: string | null;
  color: string | null;
  updated_at: string;
}

/** Tabla `events` (= torneo) con las columnas añadidas en 0003. */
export interface EventRow {
  id: string;
  name: string;
  type: string;
  region: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  source: string;
  created_at: string;
  // 0003
  circuit_id: string | null;
  tier: string | null;
  slug: string | null;
  prize_pool: number | null;
  location: string | null;
  country: string | null;
  logo: string | null;
  vlr_url: string | null;
  updated_at: string;
}

export interface StageRow {
  id: string;
  event_id: string;
  slug: string;
  name: string;
  kind: string;
  order_idx: number;
  updated_at: string;
}

export interface TeamRow {
  id: string;
  name: string;
  tag: string | null;
  region: string | null;
  logo: string | null;
  updated_at: string;
  // 0003
  full_name: string | null;
  country: string | null;
  slug: string | null;
  color: string | null;
  world_ranking: number | null;
  earnings: number | null;
  vlr_url: string | null;
  active: boolean;
}

export interface PlayerRow {
  id: string;
  nick: string;
  full_name: string | null;
  team_id: string | null;
  region: string | null;
  role: string | null;
  country: string | null;
  image: string | null;
  status: string;
  updated_at: string;
  // 0003
  agents: string[];
  vlr_url: string | null;
  earnings: number | null;
  twitter: string | null;
  number: number | null;
  is_substitute: boolean;
}

export interface AgentRow {
  id: string;
  name: string;
  role: string;
  icon: string | null;
}

export interface MapRow {
  id: string;
  name: string;
  active_pool: boolean;
}

export interface MatchRow {
  id: string;
  event_id: string | null;
  team_a: string | null;
  team_b: string | null;
  start_time: string | null;
  status: string;
  score_a: number | null;
  score_b: number | null;
  winner_team: string | null;
  updated_at: string;
  // 0003
  stage_id: string | null;
  team_a_id: string | null;
  team_b_id: string | null;
  winner_team_id: string | null;
  format: string | null;
  best_of: number;
  round: string | null;
  match_order: number | null;
  mvp_player_id: string | null;
  patch: string | null;
  vod_url: string | null;
  vlr_url: string | null;
  created_at: string;
}

export interface MatchMapRow {
  id: string;
  match_id: string;
  map_id: string | null;
  map_order: number;
  score_a: number | null;
  score_b: number | null;
  winner_team_id: string | null;
  picked_by: string | null;
  side_start: string | null;
  duration: number | null;
  created_at: string;
}

export interface MapPlayerStatRow {
  id: string;
  match_map_id: string;
  match_id: string;
  player_id: string | null;
  team_id: string | null;
  agent_id: string | null;
  acs: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  kast: number | null;
  adr: number | null;
  hs_pct: number | null;
  fk: number | null;
  fd: number | null;
  clutches: number | null;
  plus_minus: number | null;
  rating: number | null;
  created_at: string;
}

/** Tabla `player_stats` (agregado por partido) con columnas de 0003. */
export interface PlayerStatRow {
  id: string;
  match_id: string | null;
  player_id: string | null;
  acs: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  hs_pct: number | null;
  clutches: number | null;
  kast: number | null;
  created_at: string;
  // 0003
  team_id: string | null;
  agent_id: string | null;
  adr: number | null;
  kd: number | null;
  fk: number | null;
  fd: number | null;
  rating: number | null;
  plus_minus: number | null;
  maps_played: number | null;
  rounds: number | null;
}

export interface StandingRow {
  id: string;
  event_id: string;
  stage_id: string | null;
  stage_key: string;
  team_id: string;
  position: number | null;
  wins: number;
  losses: number;
  ties: number;
  maps_won: number;
  maps_lost: number;
  map_diff: number;
  rounds_won: number;
  rounds_lost: number;
  round_diff: number;
  points: number;
  group_label: string | null;
  status: string;
  updated_at: string;
}

export interface TeamStatsRow {
  id: string;
  team_id: string;
  event_id: string | null;
  event_key: string;
  scope: string;
  matches_played: number;
  matches_won: number;
  matches_lost: number;
  maps_played: number;
  maps_won: number;
  maps_lost: number;
  rounds_won: number;
  rounds_lost: number;
  attack_win_pct: number | null;
  defense_win_pct: number | null;
  pistol_win_pct: number | null;
  updated_at: string;
}

export interface PlayerEventStatsRow {
  id: string;
  player_id: string;
  event_id: string;
  rating: number | null;
  acs: number | null;
  kd: number | null;
  adr: number | null;
  kast: number | null;
  hs_pct: number | null;
  fk_per_map: number | null;
  maps: number;
  rounds: number;
  mvp_count: number;
  updated_at: string;
}

export interface RosterChangeRow {
  id: string;
  team_id: string;
  player_id: string;
  role: string | null;
  joined_at: string | null;
  left_at: string | null;
  is_active: boolean;
}

export interface SyncStateRow {
  id: string;
  last_synced_at: string | null;
  cursor: string | null;
  status: string;
  error: string | null;
  updated_at: string;
}

/* ---- IA de predicción (migración 0005_predictions.sql) ---- */

export interface TeamRatingRow {
  team_id: string;
  rating: number;
  peak_rating: number;
  games: number;
  wins: number;
  losses: number;
  region: string | null;
  last_match_at: string | null;
  updated_at: string;
}

export interface PredictionRow {
  id: string;
  match_id: string;
  model_version: string;
  provider: string;
  win_prob_a: number | null;
  win_prob_b: number | null;
  predicted_winner_id: string | null;
  predicted_score_a: number | null;
  predicted_score_b: number | null;
  confidence: number | null;
  upset_risk: number | null;
  mvp_player_id: string | null;
  breakout_player_id: string | null;
  narrative: string | null;
  key_factors: string[];
  features: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PredictionPlayerRow {
  id: string;
  match_id: string;
  player_id: string | null;
  team_id: string | null;
  kind: string;
  projected_rating: number | null;
  mvp_prob: number | null;
  breakout_score: number | null;
  created_at: string;
}

export interface ModelAccuracyRow {
  model_version: string;
  predictions: number;
  winner_hit_rate: number | null;
  brier_mean: number | null;
  score_exact_rate: number | null;
}
