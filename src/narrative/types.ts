/**
 * MATCH NARRATIVE ENGINE — Tipos.
 *
 * Convierte una simulación (rondas + eventos) en una HISTORIA. Módulo totalmente
 * independiente: solo CONSUME el estado/eventos del sim; nunca decide gameplay ni
 * muta nada. Su trabajo es recordar, interpretar y dar SIGNIFICADO.
 *
 * El cerebro es estructurado (grafo + memoria + métricas). El texto bonito es una
 * capa fina opcional encima — aquí no se escriben frases a mano por partido.
 */

/** Identificador de equipo (estable durante el partido aunque cambien de lado). */
export type TeamId = "A" | "B";

export interface TeamRef {
  id: TeamId;
  name: string;
  /** Nicks de los 5 jugadores (clave estable entre rondas). */
  players: string[];
}

/** Tipos de evento de la narrativa. Mezcla eventos crudos y NODOS derivados. */
export type NarrativeEventType =
  // — crudos de ronda —
  | "first_blood" | "kill" | "trade" | "multikill" | "ace"
  | "clutch" | "plant" | "defuse" | "retake" | "post_plant_hold"
  | "execute_fast" | "execute_slow" | "eco_win" | "timeout"
  | "round_win"
  // — derivados (cross-ronda) —
  | "tactical_shift" | "momentum_shift" | "confidence_shift" | "economy_shift"
  | "streak" | "comeback_started" | "collapse_started"
  | "disappearance" | "dominance" | "rivalry" | "inflection" | "match_end";

export type ParticipantRole = "subject" | "victim" | "ally" | "opponent";

export interface EventParticipant {
  name: string;
  team: TeamId;
  role?: string;
  as: ParticipantRole;
}

/** Nodo de la Timeline / del Story Graph. */
export interface NarrativeEvent {
  /** Id estable: `r{ronda}#{seq}` o `d:{tipo}:{ronda}` para derivados. */
  id: string;
  round: number;     // 1-based
  tick: number;      // tick dentro de su ronda (0 = nivel ronda)
  timeSec: number;   // tick / TPS
  type: NarrativeEventType;
  /** Cuán NOTABLE es (0..100). */
  importance: number;
  /** Cuánto MOVIÓ el partido (0..100). */
  impact: number;
  /** A qué equipo beneficia (null = neutro). */
  favors: TeamId | null;
  participants: EventParticipant[];
  /** Extras estructurados (clutchSize, streakLen, fromTempo/toTempo, delta…). */
  data: Record<string, unknown>;
  /** Etiquetas de significado ("opener", "highlight", "decisive"…). */
  tags: string[];
}

// ---- Story Graph (un GRAFO, no una lista: los eventos se enlazan por causa) ----
export type EdgeRelation =
  | "caused" | "enabled" | "led_to" | "triggered" | "reinforced"
  | "reversed" | "responded_to" | "culminated_in" | "contributed_to";

export interface StoryEdge {
  from: string; // NarrativeEvent.id
  to: string;   // NarrativeEvent.id
  relation: EdgeRelation;
  weight: number; // 0..1
}

export interface StoryGraph {
  nodes: NarrativeEvent[];
  edges: StoryEdge[];
}

// ---- Momentum ----
export interface MomentumPoint {
  round: number;
  /** -100 (control total de B) .. +100 (control total de A). */
  value: number;
  control: TeamId | null;
}

export interface MomentumShift {
  round: number;
  from: TeamId | null;
  to: TeamId;
  magnitude: number; // 0..100
  /** Id del evento que probablemente lo provocó (si lo hay). */
  cause: string | null;
}

// ---- Arcos de jugador ----
export type PlayerStateTag =
  | "hot" | "cold" | "tilt" | "clutch" | "pressure"
  | "disappeared" | "dominant" | "leader" | "anchor";

export interface RivalryRecord {
  vs: string;
  /** [bajas a favor, bajas en contra] en el duelo repetido. */
  record: [number, number];
}

export interface PlayerArc {
  name: string;
  team: TeamId;
  role: string;
  kills: number;
  deaths: number;
  firstBloods: number;
  firstDeaths: number;
  multikills: number;
  aces: number;
  clutches: number;
  clutchWins: number;
  tradeKills: number;
  /** Contribución agregada ponderada por importancia (no solo bajas). */
  impactScore: number;
  /** Rondas en las que fue el jugador decisivo. */
  roundsDecisive: number;
  /** Presencia por ronda (kills/supervivencia/clutch − muertes tempranas). */
  presence: number[];
  /** Tendencia de forma actual (-1..1). */
  form: number;
  bestStreak: number;
  worstStreak: number;
  states: PlayerStateTag[];
  rivalries: RivalryRecord[];
  confidenceEnd: number;
  tiltPeak: number;
}

// ---- Forma del partido ----
export type MatchShapeId =
  | "blowout" | "dominance" | "snowball" | "comeback" | "collapse"
  | "nail_biter" | "trading_blows" | "miracle" | "one_sided";

export interface MatchShape {
  id: MatchShapeId;
  confidence: number; // 0..1
  descriptors: string[];
}

// ---- Momentos clave / héroes / resumen ----
export interface KeyMoment {
  event: NarrativeEvent;
  rank: number; // 1 = el más importante
  why: string;  // etiqueta de por qué (estructural)
}

export interface Standout {
  name: string;
  team: TeamId;
  score: number;
  reason: string;
  tags: PlayerStateTag[];
}

export interface StoryBeat {
  kind: string;
  round: number | null;
  subjects: string[];
  magnitude: number; // 0..100
  refs: string[];    // ids de eventos
  /** Verbalización determinista (capa fina, plantilla rellenada con datos). */
  text: string;
}

export interface MatchSummary {
  headline: string;
  shape: MatchShapeId;
  beats: StoryBeat[];
  mvp: string | null;
  turningPoint: number | null; // ronda
}

// ---- Estado narrativo completo (API pública) ----
export interface NarrativeState {
  match: {
    teams: Record<TeamId, TeamRef>;
    score: Record<TeamId, number>;
    winner: TeamId | null;
    rounds: number;
    shape: MatchShape;
  };
  timeline: NarrativeEvent[];
  graph: StoryGraph;
  keyMoments: KeyMoment[];
  momentum: { series: MomentumPoint[]; shifts: MomentumShift[] };
  players: PlayerArc[];
  heroes: Standout[];
  villains: Standout[];
  summary: MatchSummary;
}
