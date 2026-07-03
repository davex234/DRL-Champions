/**
 * TOURNAMENT ANALYZER — tipos del INFORME (Card Generator Fase 2/7).
 *
 * Todo es OBJETIVO, SERIALIZABLE (arrays / objetos planos, sin Map) y DETERMINISTA. NO hay cartas,
 * OVR, rarezas ni traits: solo análisis de datos derivado del Canonical Model de la Fase 1.
 */
import type { MatchStatus } from "@/importer";

export const ANALYZER_SCHEMA_VERSION = 1;

export type Trend = "rising" | "falling" | "steady" | "unknown";

/** Puntuaciones de rol 0..100 (funciones deterministas de las stats objetivas). */
export interface RoleScores {
  duelist: number;
  controller: number;
  initiator: number;
  sentinel: number;
  entry: number;
  support: number;
  anchor: number;
}

export interface PlayerReport {
  playerId: string;
  nick: string;
  teamId?: string;
  role?: string;
  maps: number;
  matches: number;
  // Agregados objetivos (promedios por mapa salvo totales indicados).
  acs: number;
  adr: number;
  kast: number;
  kd: number;
  hsPct: number;
  kills: number;   // total
  deaths: number;  // total
  assists: number; // total
  fk: number;      // total
  fd: number;      // total
  clutches: number; // total
  // Métricas derivadas.
  rating: number;      // 0..99 (contextualRating reutilizado)
  impact: number;      // 0..100 (rawPerformance reutilizado)
  consistency: number; // 0..100
  variance: number;
  mvpScore: number;    // 0..100
  roles: RoleScores;
  rolePerformance: number; // score del rol asignado (o el mejor)
  trend: Trend;
  peakMatchId?: string;
  worstMatchId?: string;
}

export interface TeamReport {
  teamId: string;
  name: string;
  wins: number;
  losses: number;
  mapsWon: number;
  mapsLost: number;
  roundDiff: number;
  series: number;
  winrate: number;             // 0..1
  strengthOfSchedule: number;  // 0..1 (winrate medio de rivales)
  /** Economía objetiva si existiera en el modelo; en Fase 1 el modelo no la trae → undefined. */
  economy?: { pistolWinPct?: number; attackWinPct?: number; defenseWinPct?: number };
  placement?: number;
  eliminated: boolean;
  qualified: boolean;
  champion: boolean;
  runnerUp: boolean;
  thirdPlace: boolean;
  groupWinner: boolean;
  reachedPlayoff: boolean;
  perfectRun: boolean;
  reverseSweep: boolean;
  lowerBracketRun: boolean;
  cinderellaRun: boolean;
}

export type AwardKind =
  | "mvp" | "best-duelist" | "best-controller" | "best-sentinel" | "best-initiator" | "best-flex"
  | "best-rookie" | "best-igl" | "best-coach" | "best-clutch" | "best-entry" | "best-support"
  | "best-team" | "most-improved" | "biggest-surprise" | "biggest-disappointment";

/** Premio OBJETIVO (sin cardId/variant/accolade — eso es de la fase de cartas). */
export interface AwardResult {
  kind: AwardKind;
  playerId?: string;
  teamId?: string;
  coachId?: string;
  value: number;
  reason: string;
}

export type StoryTagKind =
  | "dominated" | "underdog" | "upset" | "miracle-run" | "perfect-playoffs" | "collapse"
  | "redemption" | "flawless-finals" | "reverse-sweep" | "close-finals" | "dynasty" | "new-generation";

/** Etiqueta narrativa ESTRUCTURADA (nunca frases ni IA generativa). */
export interface StoryTag {
  kind: StoryTagKind;
  teamId?: string;
  playerId?: string;
  reason: string;
}

export interface TournamentRecord {
  kind: string;
  playerId?: string;
  teamId?: string;
  matchId?: string;
  value: number;
  label: string;
}

export interface TimelineEntry {
  matchId: string;
  order: number;
  stageId?: string;
  round?: string;
  teamAId: string;
  teamBId: string;
  scoreA?: number;
  scoreB?: number;
  winnerTeamId?: string;
}

export interface TournamentSummary {
  teams: number;
  players: number;
  matches: number;
  maps: number;
  championTeamId?: string;
  runnerUpTeamId?: string;
  mvpPlayerId?: string;
}

export interface TournamentReport {
  schemaVersion: number;
  tournamentId: string;
  name: string;
  status: MatchStatus;
  summary: TournamentSummary;
  players: PlayerReport[];
  teams: TeamReport[];
  awards: AwardResult[];
  storyTags: StoryTag[];
  records: TournamentRecord[];
  rankings: { byRating: string[]; byImpact: string[]; byAcs: string[] };
  placements: { position: number; teamId: string }[];
  mvpCandidates: { playerId: string; mvpScore: number }[];
  eliminatedTeams: string[];
  qualifiedTeams: string[];
  timeline: TimelineEntry[];
}
