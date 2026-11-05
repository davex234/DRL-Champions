/**
 * DRL PREDICT — tipos del motor de análisis competitivo.
 *
 * El modelo estadístico (Elo + logística + forma/H2H/mapas) produce las
 * probabilidades; la capa de IA añade la narrativa. Tipos PUROS de dominio.
 */

export const MODEL_VERSION = "drl-stat-v1";

/** Resumen de forma reciente de un equipo. */
export interface FormSummary {
  /** Nº de partidos considerados. */
  matches: number;
  /** Ratio de victorias (0-1). */
  winRate: number;
  /** Ratio de mapas ganados (0-1). */
  mapWinRate: number;
  /** Momento: tendencia ponderada por recencia (-1..1). */
  momentum: number;
}

/** Enfrentamiento directo entre dos equipos. */
export interface HeadToHead {
  gamesA: number;
  gamesB: number;
  /** Diferencia de mapas a favor de A. */
  mapDiffA: number;
}

/** Features de un partido, listas para el modelo. */
export interface MatchFeatures {
  matchId: string;
  teamAId: string;
  teamBId: string;
  teamAName?: string;
  teamBName?: string;
  bestOf: number;
  eloA: number;
  eloB: number;
  formA: FormSummary;
  formB: FormSummary;
  h2h: HeadToHead;
  /** Ventaja neta de A en el pool de mapas (-1..1). */
  mapEdgeA: number;
}

/** Forma de un jugador para proyectar MVP / revelación. */
export interface PlayerForm {
  playerId: string;
  teamId: string;
  nick?: string;
  /** Rating reciente (forma actual). */
  recentRating: number;
  /** Rating histórico/base (línea de partida). */
  baselineRating: number;
  /** Mapas jugados (volumen de muestra). */
  maps: number;
}

export interface PlayerProjection {
  playerId: string;
  teamId: string;
  kind: "mvp" | "breakout" | "projection";
  projectedRating: number;
  mvpProb?: number;
  breakoutScore?: number;
}

/** Salida del modelo estadístico para un partido. */
export interface ModelOutput {
  winProbA: number;
  winProbB: number;
  predictedWinnerId: string;
  predictedScoreA: number;
  predictedScoreB: number;
  confidence: number;
  upsetRisk: number;
}

/** Análisis cualitativo de la capa de IA. */
export interface AIAnalysis {
  provider: string;
  narrative: string;
  keyFactors: string[];
  upsetRisk?: number;
  mvpReasoning?: string;
}

/** Predicción completa (modelo + IA) que se persiste. */
export interface Prediction extends ModelOutput {
  matchId: string;
  modelVersion: string;
  provider: string;
  mvpPlayerId?: string;
  breakoutPlayerId?: string;
  narrative?: string;
  keyFactors: string[];
  features: MatchFeatures;
}

export interface TeamRating {
  teamId: string;
  rating: number;
  peakRating: number;
  games: number;
  wins: number;
  losses: number;
  region?: string;
}
