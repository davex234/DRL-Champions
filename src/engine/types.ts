/**
 * DRL DATA ENGINE — tipos.
 *
 * Flujo: VLRSource (crudo) → normalización → tipos de dominio del engine →
 * generación de cartas/eventos → inserción en el juego. NUNCA se usan los
 * datos crudos de VLR directamente en el juego.
 */
import type { Player } from "@/domain/cards/types";

export type TournamentType =
  | "masters"
  | "champions"
  | "ewc"
  | "game-changers"
  | "regional"
  | "off-season"
  | "ascension"
  | "other";

export type MatchStatus = "upcoming" | "live" | "finished";

// ---- Datos CRUDOS (forma aproximada de VLR, antes de normalizar) ----
export interface RawTournament {
  id: string;
  name: string;
  region?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}
export interface RawTeam {
  id: string;
  name: string;
  tag?: string;
  region?: string;
}
export interface RawMatch {
  id: string;
  tournamentId: string;
  teamAId: string;
  teamBId: string;
  startTime: string; // ISO
  status?: string;
  scoreA?: number;
  scoreB?: number;
  winnerTeamId?: string;
}
export interface RawPlayerStat {
  playerId: string;
  nick: string;
  teamId: string;
  region?: string;
  role?: string;
  country?: string;
  acs?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  hsPct?: number;
  clutches?: number;
  kast?: number;
}
export interface RawResult {
  tournamentId: string;
  winnerTeamId: string;
  mvpPlayerId?: string;
  stats: RawPlayerStat[];
}

// ---- Tipos de DOMINIO del engine (ya normalizados) ----
export interface Tournament {
  id: string;
  name: string;
  type: TournamentType;
  region?: string;
  status: MatchStatus; // upcoming | live | finished (a nivel torneo)
  startDate?: string;
  endDate?: string;
}
export interface Match {
  id: string;
  tournamentId: string;
  teamA: string;
  teamB: string;
  startTime: number; // epoch ms
  status: MatchStatus;
  scoreA?: number;
  scoreB?: number;
  winner?: string; // nombre del equipo ganador
}

export type CardKind = "series" | "winner" | "mvp" | "icon" | "prime";

/** Registro de una carta generada por el engine (metadatos + confianza). */
export interface GeneratedCard {
  id: string;
  tournamentId: string;
  tournamentName: string;
  kind: CardKind;
  playerId: string;
  playerNick: string;
  /** Accolade que se aplicará al jugador para materializar la carta. */
  accolade: string;
  serialLimit?: number;
  /** Confianza 0-1. < 0.9 ⇒ requiere aprobación manual. */
  confidence: number;
  issues: string[];
  status: "applied" | "pending" | "rejected";
  createdAt: number;
  /** Jugador normalizado a aplicar al roster. */
  player: Player;
}

export type LogLevel = "info" | "warn" | "error";
export interface EngineLog {
  id: string;
  at: number;
  level: LogLevel;
  module: string;
  message: string;
}

export type NotificationCode =
  | "player_not_found"
  | "image_not_found"
  | "logo_not_found"
  | "inconsistent_data"
  | "mvp_not_identified"
  | "scraping_error"
  | "generation_error"
  | "approval_required"
  | "info";

export interface EngineNotification {
  id: string;
  at: number;
  code: NotificationCode;
  level: LogLevel;
  message: string;
  sentTelegram: boolean;
}

export type JobKind = "sync" | "monitor_match" | "process_tournament";
export interface SchedulerJob {
  id: string;
  kind: JobKind;
  runAt: number;
  payload?: Record<string, unknown>;
  status: "scheduled" | "done";
  label: string;
}

/** Predicción de un usuario (Pick'em) sobre un partido. */
export interface Pickem {
  matchId: string;
  pick: string; // nombre del equipo elegido
  resolved: boolean;
  correct?: boolean;
  at: number;
}

/** Interfaz de cualquier fuente de datos (VLR, mock, API oficial…). */
export interface DataSource {
  id: string;
  label: string;
  getTournaments(): Promise<RawTournament[]>;
  getTeams(tournamentId: string): Promise<RawTeam[]>;
  getMatches(tournamentId: string): Promise<RawMatch[]>;
  getResult(tournamentId: string): Promise<RawResult | null>;
}
