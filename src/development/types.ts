/**
 * PLAYER DEVELOPMENT ENGINE — Tipos.
 *
 * Capa PERSISTENTE que evoluciona a un jugador entre partidos/temporadas. NO crea otro
 * Identity/Mental/Combat: produce DELTAS que se inyectan en `RosterEntry.attrs/identity`
 * (el sim ya los consume). El desarrollo es EMERGENTE (nace de lo que pasó en la partida,
 * leído de `PlayerArc`/mental), nunca scripts. Todo PLANO y clonable (persistible).
 */
import type { Attributes, TraitKey } from "@/sim";

/** Habilidades APRENDIDAS (0..100) — distintas del ADN: se ganan jugando/entrenando. */
export type SkillId =
  | "entry" | "retake" | "postplant" | "clutch" | "igl" | "trade" | "support" | "lurk" | "economy";

export const SKILL_IDS: SkillId[] = ["entry", "retake", "postplant", "clutch", "igl", "trade", "support", "lurk", "economy"];

/** Perfil INNATO, determinista por id del jugador (no todos llegan igual). */
export interface InnateProfile {
  playerId: string;
  /** Edad al empezar la carrera (16..27). */
  startAge: number;
  /** Techo de desarrollo (0..100): cuánto puede llegar a crecer. */
  potential: number;
  /** Ritmo de mejora (0.5..1.5): cómo de rápido aprende. */
  growthRate: number;
  /** Ética de trabajo (0..100): eficiencia del entrenamiento + resistencia al burnout. */
  workEthic: number;
  /** Aguante físico/mental (0..100): resistencia a la fatiga. */
  durability: number;
  /** Ambición (0..100): sostiene la motivación. */
  ambition: number;
  /** Edad de pico de rendimiento (~23..27). */
  peakAge: number;
  /** Edad de inicio del declive (~28..32). */
  declineAge: number;
}

/** Condición PERSISTENTE (fatiga/forma/motivación…) — sobrevive entre partidos. */
export interface PlayerCondition {
  fatigue: number;     // 0..100 (cansancio acumulado)
  burnout: number;     // 0..100 (agotamiento crónico)
  form: number;        // 0..100 (50 = neutral; racha de rendimiento)
  motivation: number;  // 0..100
  confidence: number;  // 0..100 (confianza BASE, distinta de la mental de partido)
  morale: number;      // 0..100
  stress: number;      // 0..100
}

/** Estado de desarrollo PERSISTENTE de un jugador. */
export interface DevState {
  playerId: string;
  age: number;
  matchesPlayed: number;
  seasonsPlayed: number;
  /** Deltas acumulados al ADN (se SUMAN a la identidad derivada de la carta). */
  traitDelta: Partial<Record<TraitKey, number>>;
  /** Deltas acumulados a los atributos de combate. */
  attrDelta: Record<keyof Attributes, number>;
  /** Habilidades aprendidas (0..100, 50 = base). */
  skill: Record<SkillId, number>;
  condition: PlayerCondition;
  /** Mejor índice de progreso alcanzado (para detectar declive). */
  peak: number;
  /** Memoria del jugador: temporadas/torneos/MVP/clutches/errores… */
  history: CareerEvent[];
}

export interface CareerEvent {
  season: number;
  kind: "match" | "season" | "training" | "milestone";
  text: string;
  data?: Record<string, number | string | boolean>;
}

/** Relación (química) entre dos jugadores. */
export interface Relationship {
  /** Ids ORDENADOS (a < b). */
  a: string;
  b: string;
  compatibility: number; // 0..100 (afinidad base por personalidad)
  trust: number;         // 0..100
  respect: number;       // 0..100
  communication: number; // 0..100
  synergy: number;       // 0..100 (juego conjunto efectivo)
  conflict: number;      // 0..100 (roces)
  sharedMatches: number;
}

/** Señales de EXPERIENCIA de un jugador en un partido (leídas de PlayerArc + mental). */
export interface ExperienceSignals {
  playerId: string;
  name: string;
  rounds: number;
  kills: number;
  deaths: number;
  firstBloods: number;
  firstDeaths: number;
  multikills: number;
  aces: number;
  clutches: number;
  clutchWins: number;
  tradeKills: number;
  impactScore: number;
  roundsDecisive: number;
  /** Tendencia de forma -1..1 (de PlayerArc). */
  form: number;
  tiltPeak: number;
  confidenceEnd: number;
  states: string[];
  utilityCasts: number;
  won: boolean;
  mvp: boolean;
  role: string;
}

export type TrainingSessionId =
  | "aim" | "utility" | "retake" | "execute" | "mental" | "teamplay" | "communication" | "review" | "rest";

export type TrainingIntensity = "light" | "normal" | "hard";

export interface TrainingSession {
  id: TrainingSessionId;
  intensity: TrainingIntensity;
}

/** Snapshot compacto para detectar transiciones (narrativa). */
export interface DevSnapshot {
  rating: number;
  age: number;
  condition: PlayerCondition;
  topTrait?: { key: TraitKey; delta: number };
}

export interface DevTransition {
  playerId: string;
  name?: string;
  cause: "match" | "training" | "season";
  season: number;
  before: DevSnapshot;
  after: DevSnapshot;
  /** Resumen de qué cambió (para narrativa/broadcast). */
  changes: { traits: Partial<Record<TraitKey, number>>; attrs: Partial<Record<keyof Attributes, number>>; skills: Partial<Record<SkillId, number>> };
}

export type DevelopmentEventType =
  | "breakthrough" | "slump" | "legendary_season" | "confidence_lost" | "burnout"
  | "perfect_training" | "tactical_growth" | "leadership_growth" | "veteran_mentor"
  | "new_star" | "everything_clicks" | "mental_collapse";

export interface DevelopmentEvent {
  type: DevelopmentEventType;
  playerId: string;
  name?: string;
  season: number;
  magnitude: number; // 1..100
  detail?: string;
}

export interface ScoutReport {
  playerId: string;
  age: number;
  ageBand: "joven" | "prime" | "veterano" | "declive";
  potential: number;
  /** Cuánto del potencial ya se ha alcanzado (0..100). */
  ceilingReached: number;
  growth: number;
  personality: string;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  recommendation: string;
}
