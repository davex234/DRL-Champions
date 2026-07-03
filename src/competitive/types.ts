/**
 * COMPETITIVE RANKING — vocabulario compartido (Online Fase 3/7).
 *
 * Sistema competitivo que se alimenta SOLO de resultados de partida (MatchResult, autoritativo).
 * REUTILIZA el Elo existente (`@/domain/esports/predict/elo`), no crea otro rating/perfil. Flujo
 * único: Match End → Competitive Engine → MMR → División → Temporada → Leaderboard → Career/World/
 * Presentation. Todo PLANO/clonable y DETERMINISTA (reloj lógico, sin Date.now/Math.random).
 * Depende de matchmaking/online (nunca al revés). No es amigos/party/torneos/clanes.
 */
import type { Region } from "@/domain/cards/types";

// ───────────────────────────── Ligas / divisiones ─────────────────────────────

export type LeagueId = "iron" | "bronze" | "silver" | "gold" | "platinum" | "diamond" | "master" | "grandmaster" | "champion";

export interface LeagueDef { id: LeagueId; floor: number; ceil: number; divisions: number; apex: boolean }

// ───────────────────────────── Series / temporada / historial ─────────────────────────────

/** Serie de promoción (best-of): ganar `needed` para ascender. */
export interface PromotionSeries { fromLeague: LeagueId; toLeague: LeagueId; wins: number; losses: number; target: number; needed: number }

export interface SeasonRecord {
  season: number;
  wins: number;
  losses: number;
  peakMmr: number;
  peakLeague: LeagueId | null;
  endMmr: number;
  endLeague: LeagueId | null;
}

export interface MatchOutcomeLite { matchId: string; won: boolean; mmrDelta: number; at: number }

// ───────────────────────────── Perfil competitivo ─────────────────────────────

export interface CompetitiveProfile {
  id: string;
  name: string;
  region: Region;
  mmr: number;               // oculto durante placements
  peakMmr: number;
  placementGames: number;    // 0..10
  league: LeagueId | null;   // null durante placements
  division: number;          // 1..4 (1 = más alto) · 0 = apex
  series: PromotionSeries | null;
  shieldGames: number;       // rank shield (protección de descenso)
  wins: number;
  losses: number;
  streak: number;            // + racha de victorias, − racha de derrotas
  mvps: number;
  coachRating: number;       // REUTILIZADO de career (informativo)
  season: SeasonRecord;
  history: SeasonRecord[];
  bestLeague: LeagueId | null;
  lastMatches: MatchOutcomeLite[];  // últimos N (capado)
  processed: string[];              // matchIds recientes procesados (anti doble-actualización)
  lastActiveAt: number;             // para decay
}

// ───────────────────────────── Entrada: resultado de partida ─────────────────────────────

/** Resultado AUTORITATIVO de una partida (derivado del MatchState del servidor). Nunca del cliente. */
export interface CompetitiveMatchResult {
  matchId: string;
  season: number;            // debe coincidir con la temporada activa (anti corrupción)
  mode: string;              // solo "competitive" puntúa
  homeId: string;
  awayId: string;
  winner: "home" | "away";
  scoreHome: number;
  scoreAway: number;
  mvp: "home" | "away" | null;
  region: Region;
  at: number;
}

// ───────────────────────────── Leaderboard / eventos / recompensas ─────────────────────────────

export type LeaderboardScope = "global" | "regional" | "coach" | "club" | "season" | "historic";
export interface LeaderboardEntry { id: string; name: string; mmr: number; region: Region; league: LeagueId | null; division: number; wins: number; losses: number }

export type RankEventType = "promoted" | "demoted" | "series_start" | "series_win" | "series_loss" | "placed" | "decayed";
export interface RankEvent { type: RankEventType; playerId: string; at: number; from: string; to: string; detail: string }

export interface CompetitiveUpdate {
  matchId: string;
  players: { id: string; mmrBefore: number; mmrAfter: number; mmrDelta: number; rankBefore: string; rankAfter: string; won: boolean }[];
  events: RankEvent[];
}

export type RewardTier = "none" | "iron" | "bronze" | "silver" | "gold" | "platinum" | "diamond" | "master" | "grandmaster" | "champion";
export interface SeasonReward { playerId: string; tier: RewardTier; medal: string; badge: string; peakLeague: LeagueId | null }
