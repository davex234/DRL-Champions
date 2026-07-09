/**
 * TOURNAMENT ANALYZER — tipos del INFORME (Card Generator Fase 2/7).
 *
 * Todo es OBJETIVO, SERIALIZABLE (arrays / objetos planos, sin Map) y DETERMINISTA. NO hay cartas,
 * OVR, rarezas ni traits: solo análisis de datos derivado del Canonical Model de la Fase 1.
 */
import type { MatchStatus } from "@/importer";
import type { TournamentType } from "@/engine/types";

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

/* ────────────────────────────────────────────────────────────────────────────
 * FASE 3 — PERFORMANCE ANALYZER (tipos ADITIVOS; el TournamentReport de F2 no cambia).
 * Todo OBJETIVO, SERIALIZABLE y DETERMINISTA. Sin cartas/OVR/rareza/variantes.
 * ──────────────────────────────────────────────────────────────────────────── */

export const ANALYZER_RESULT_SCHEMA_VERSION = 2;

export type ConfidenceLevel = "low" | "medium" | "high";

/** Confianza estadística de una performance — SOLO cobertura de datos, nunca manual. */
export interface PerformanceConfidence {
  level: ConfidenceLevel;
  maps: number;
  matches: number;
  /** Rondas observadas en los mapas del jugador (rounds del modelo o scores; 0 si no hay dato). */
  rounds: number;
  /** 0..1 — fracción de campos estadísticos presentes en sus stat-lines. */
  coverage: number;
}

/** Métricas compuestas 0..100 por jugador (escalas de referencia fijas de `aggregate.ts`). */
export interface PerformanceMetrics {
  playerId: string;
  efficiency: number;   // kd/adr/kast compuestos
  clutchScore: number;  // clutches por mapa (escala 1.2) + kd
  entryScore: number;   // = RoleScores.entry (promovido a primer nivel)
  supportScore: number; // = RoleScores.support (promovido a primer nivel)
  flexScore: number;    // nº de agentes distintos × reparto equilibrado
  confidence: PerformanceConfidence;
}

/** Métricas por (jugador × agente) — solo si el dato de agente existe en las stats. */
export interface AgentMetrics {
  playerId: string;
  agentId: string;
  maps: number;
  wins: number;
  winrate: number; // 0..1 (sobre mapas con ganador conocido)
  acs: number; adr: number; kast: number; kd: number;
  kills: number; deaths: number; assists: number; clutches: number;
}

/** Agregado del torneo por agente. */
export interface AgentUsage {
  agentId: string;
  picks: number;   // stat-lines (map-picks)
  players: number; // jugadores distintos
  winrate: number; // 0..1
  acs: number;     // ACS medio
}

/** Métricas por GameMap del pool. `attack/defenseWinPct` solo si hay rounds con lado. */
export interface MapMetrics {
  mapId: string;
  played: number;
  attackWinPct?: number;  // 0..100
  defenseWinPct?: number; // 0..100
  avgRoundsPerMap?: number;
  dominantTeamId?: string; // más mapas ganados (empate → undefined)
}

/** Economía objetiva por equipo derivada de `model.rounds` (tipo de ronda + ganador). */
export interface TeamEconomy {
  teamId: string;
  pistolWinPct?: number; ecoWinPct?: number; forceWinPct?: number; buyWinPct?: number; // 0..100
  roundsSampled: number;
}

export interface PerformanceTimelinePoint {
  matchId: string;
  order: number;
  maps: number;
  impact: number; // 0..100 (rawPerformance reutilizado)
  acs: number;
  kills: number;
  deaths: number;
}

/** Serie partido a partido del rendimiento de un jugador (materializa lo que F2 reducía). */
export interface PerformanceTimeline {
  playerId: string;
  points: PerformanceTimelinePoint[];
}

export type OutlierMetric = "acs" | "adr" | "kast" | "kd" | "clutchesPerMap" | "fkPerMap" | "hsPct";

/** Outlier estadístico: |z| ≥ 2 sobre la población de jugadores con muestra mínima. */
export interface StatisticalOutlier {
  playerId: string;
  metric: OutlierMetric;
  value: number;
  mean: number;
  stdev: number;
  zscore: number;
  direction: "high" | "low";
}

export type AllStarSlotKind = "duelist" | "controller" | "initiator" | "sentinel" | "flex";

/** Quinteto all-star: argmax de role score por puesto, sin jugador repetido. */
export interface AllStarSlot {
  slot: AllStarSlotKind;
  playerId: string;
  score: number; // role score del puesto (mvpScore en flex)
}

export type HighlightMetric = "acs" | "kills" | "clutches" | "fk" | "adr" | "hsPct";

/** Actuación de mapa estadísticamente excepcional (z ≥ 2 sobre todas las stat-lines). */
export interface HighlightCandidate {
  playerId: string;
  matchId: string;
  matchMapId: string;
  metric: HighlightMetric;
  value: number;
  zscore: number;
}

export type NarrativeTagKind =
  | "champion" | "runner-up" | "grand-finalist" | "top4" | "top8"
  | "dark-horse" | "cinderella-run" | "reverse-sweep" | "perfect-run" | "lower-bracket-run"
  | "group-stage-exit" | "swiss-qualified" | "swiss-eliminated" | "undefeated";

/** Etiqueta narrativa OBJETIVA por equipo (solo hechos de resultados, nunca historias). */
export interface NarrativeTag {
  kind: NarrativeTagKind;
  teamId: string;
  reason: string;
}

export type HistoricalTagKind =
  | "first-international" | "first-masters" | "first-champions" | "first-title"
  | "second-title" | "three-titles" | "debut-lan" | "debut-international"
  | "best-placement" | "career-high" | "career-low"
  | "back-to-back-champion" | "repeat-champion";

/** Contexto histórico OBJETIVO (solo derivable del historial inyectado). */
export interface HistoricalTag {
  kind: HistoricalTagKind;
  teamId?: string;
  playerId?: string;
  value?: number;
  reason: string;
}

/**
 * Hecho OBJETIVO de un torneo ANTERIOR (extraíble de un AnalyzerResult previo). El Analyzer es
 * puro: el historial se INYECTA; si no se inyecta, el bloque histórico se omite (provided=false).
 */
export interface TournamentFact {
  tournamentId: string;
  type: TournamentType;
  endDate?: number; // epoch ms
  championTeamId?: string;
  placements?: { position: number; teamId: string }[];
  teamIds?: string[];
  playerIds?: string[];
  playerRatings?: { playerId: string; rating: number }[];
}

export interface HistoricalContext {
  /** true si el llamador inyectó historial (incluso vacío = "no hay registro previo conocido"). */
  provided: boolean;
  tournaments: number;
  tags: HistoricalTag[];
}

/** Salida FINAL de la Fase 3 — el contrato que consumirá el Card Generator (Fase 4). */
export interface AnalyzerResult {
  schemaVersion: number; // ANALYZER_RESULT_SCHEMA_VERSION
  tournamentId: string;
  /** Informe F2 ÍNTEGRO (byte a byte el de `analyzeTournament`). */
  report: TournamentReport;
  performance: PerformanceMetrics[];
  agents: AgentMetrics[];
  agentPool: AgentUsage[];
  maps: MapMetrics[];
  economy: TeamEconomy[];
  timelines: PerformanceTimeline[];
  outliers: StatisticalOutlier[];
  candidates: {
    mvp: { playerId: string; mvpScore: number }[];
    allStar: AllStarSlot[];
    highlights: HighlightCandidate[];
  };
  narrativeTags: NarrativeTag[];
  historicalContext: HistoricalContext;
}
