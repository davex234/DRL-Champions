/**
 * DRL ESPORTS — tipos de dominio del sistema competitivo (estilo VLR.gg).
 *
 * Modelo en 3 niveles: Circuit → Tournament → Stage → Match → MatchMap →
 * MapPlayerStat, más clasificaciones (Standing) y agregados (TeamStats,
 * PlayerEventStats). Son tipos PUROS de dominio (camelCase), independientes de
 * las filas SQL (snake_case) que viven en `@/lib/supabase/esports.types`.
 *
 * Nota: el `Player` del juego de cartas (`@/domain/cards/types`) es otra cosa;
 * aquí `ProPlayer` representa al jugador profesional del catálogo deportivo.
 */
import type { Region } from "@/domain/cards/types";
import type { MatchStatus } from "@/engine/types";

export type { MatchStatus };

export type CircuitTier =
  | "vct-international"
  | "challengers"
  | "game-changers"
  | "ascension"
  | "tier2"
  | "tier3";

export type CircuitScope = "international" | "regional" | "national";
export type StageKind = "group" | "swiss" | "playoff" | "bracket" | "showmatch";
export type MatchFormat = "bo1" | "bo3" | "bo5";
export type AgentRole = "duelist" | "initiator" | "sentinel" | "controller";
export type StandingStatus = "active" | "qualified" | "eliminated";
export type TeamStatsScope = "tournament" | "season" | "global";

export interface Circuit {
  id: string;
  name: string;
  tier: CircuitTier;
  region?: string;
  scope: CircuitScope;
  parentCircuitId?: string;
  logo?: string;
  color?: string;
}

/** Una edición concreta de torneo (mapeada a la tabla `events`). */
export interface Tournament {
  id: string;
  name: string;
  type: string;
  circuitId?: string;
  tier?: CircuitTier;
  region?: string;
  status: MatchStatus;
  slug?: string;
  prizePool?: number;
  location?: string;
  country?: string;
  logo?: string;
  vlrUrl?: string;
  startDate?: string;
  endDate?: string;
}

export interface Stage {
  id: string;
  eventId: string;
  slug: string;
  name: string;
  kind: StageKind;
  orderIdx: number;
}

export interface ProTeam {
  id: string;
  name: string;
  tag?: string;
  fullName?: string;
  region?: Region | string;
  country?: string;
  slug?: string;
  logo?: string;
  color?: string;
  worldRanking?: number;
  earnings?: number;
  vlrUrl?: string;
  active: boolean;
}

export interface ProPlayer {
  id: string;
  nick: string;
  fullName?: string;
  teamId?: string;
  region?: Region | string;
  role?: string;
  country?: string;
  image?: string;
  status: string;
  agents: string[];
  vlrUrl?: string;
  earnings?: number;
  twitter?: string;
  number?: number;
  isSubstitute: boolean;
}

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  icon?: string;
}

export interface GameMap {
  id: string;
  name: string;
  activePool: boolean;
}

export interface Match {
  id: string;
  eventId?: string;
  stageId?: string;
  teamAId?: string;
  teamBId?: string;
  startTime?: number; // epoch ms
  status: MatchStatus;
  format: MatchFormat;
  bestOf: number;
  round?: string;
  matchOrder?: number;
  scoreA?: number;
  scoreB?: number;
  winnerTeamId?: string;
  mvpPlayerId?: string;
  patch?: string;
  vodUrl?: string;
  vlrUrl?: string;
}

export interface MatchMap {
  id: string;
  matchId: string;
  mapId?: string;
  mapOrder: number;
  scoreA?: number;
  scoreB?: number;
  winnerTeamId?: string;
  pickedBy?: string;
  sideStart?: string;
  duration?: number;
}

export interface MapPlayerStat {
  id: string;
  matchMapId: string;
  matchId: string;
  playerId?: string;
  teamId?: string;
  agentId?: string;
  acs?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  kast?: number;
  adr?: number;
  hsPct?: number;
  fk?: number;
  fd?: number;
  clutches?: number;
  plusMinus?: number;
  rating?: number;
}

/** Estadística agregada por partido y jugador (tabla `player_stats`). */
export interface PlayerMatchStat {
  matchId: string;
  playerId: string;
  teamId?: string;
  agentId?: string;
  acs?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  hsPct?: number;
  clutches?: number;
  kast?: number;
  adr?: number;
  kd?: number;
  fk?: number;
  fd?: number;
  rating?: number;
  plusMinus?: number;
  mapsPlayed?: number;
  rounds?: number;
}

export interface Standing {
  id: string;
  eventId: string;
  stageId?: string;
  teamId: string;
  position?: number;
  wins: number;
  losses: number;
  ties: number;
  mapsWon: number;
  mapsLost: number;
  mapDiff: number;
  roundsWon: number;
  roundsLost: number;
  roundDiff: number;
  points: number;
  groupLabel?: string;
  status: StandingStatus;
}

export interface TeamStats {
  id: string;
  teamId: string;
  eventId?: string;
  scope: TeamStatsScope;
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  mapsPlayed: number;
  mapsWon: number;
  mapsLost: number;
  roundsWon: number;
  roundsLost: number;
  attackWinPct?: number;
  defenseWinPct?: number;
  pistolWinPct?: number;
}

export interface PlayerEventStats {
  id: string;
  playerId: string;
  eventId: string;
  rating?: number;
  acs?: number;
  kd?: number;
  adr?: number;
  kast?: number;
  hsPct?: number;
  fkPerMap?: number;
  maps: number;
  rounds: number;
  mvpCount: number;
}
