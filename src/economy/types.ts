/**
 * ECONOMY ENGINE — Tipos del "cerebro económico" del partido.
 *
 * No es un contador de dinero: produce ESTADOS y DECISIONES con significado táctico
 * (eco, force, full, bonus, economía rota, recuperación, force a match point…) y
 * alimenta a Tactical, Narrative, Match, Broadcast e Identity SIN modificarlos.
 *
 * Módulo PURO (sin React) y plano (clonable), como el resto del motor. No simula
 * combate ni modela armas/escudo/utilidad (eso es de fases futuras).
 */

/** Equipo (independiente del lado). Coincide estructuralmente con `match.TeamSlot`. */
export type TeamSlot = "home" | "away";

/** Nivel de compra (qué decide comprar el equipo). save < eco < half < force < full. */
export type BuyTier = "save" | "eco" | "half" | "force" | "full";

/** Estado táctico de la economía de un equipo en una ronda. */
export type EconomyStatus =
  | "stable"
  | "broken"
  | "recovery"
  | "bonus"
  | "match_point_force";

/** Reglas económicas CONFIGURABLES (sin números mágicos en la lógica). */
export interface EconomyRules {
  /** Créditos iniciales (ronda pistola). */
  start: number;
  /** Tope de créditos. */
  max: number;
  /** Recompensa por ganar la ronda. */
  win: number;
  /** Bono de derrota base y su crecimiento por racha (con tope). */
  lossBase: number;
  lossStep: number;
  lossMax: number;
  /** Recompensa por baja. */
  kill: number;
  /** Coste por jugador de cada nivel de compra. */
  costs: Record<BuyTier, number>;
}

/** Economía de UN equipo (estado plano y persistente). */
export interface TeamEconomyState {
  /** Créditos por jugador (name → créditos). */
  players: Record<string, number>;
  /** Racha de derrotas (alimenta el bono de derrota). */
  lossStreak: number;
  /** Compra de la ronda anterior. */
  prevBuy: BuyTier | null;
  /** Estado económico de la ronda anterior. */
  prevStatus: EconomyStatus | null;
  /** Compra prevista para la ronda actual (la decide el motor). */
  plannedBuy: BuyTier | null;
  /** Decisión completa de la ronda actual (para broadcast/tactical/narrativa). */
  lastDecision: BuyDecision | null;
  /** Bono disponible (ganaron un eco/save → conservan "armas"). */
  bonus: boolean;
  /** Gasto de la ronda actual. */
  spentThisRound: number;
  /** Créditos totales antes del gasto de la ronda actual (para el historial). */
  beforeTotal: number;
  /** Economía perdida acumulada (gasto en rondas perdidas). */
  lostTotal: number;
  /** Temperamento de compra del equipo (de la identidad de sus jugadores, -1..1). */
  buyBias: number;
}

/** Métricas derivadas de un equipo (lo que TeamEconomy "conoce"). */
export interface TeamMetrics {
  total: number;
  avg: number;
  min: number;
  max: number;
  /** Capacidad de compra (0..~1.2 respecto a un full buy). */
  buyingPower: number;
  /** Estabilidad (0..1; 1 = todos parejos). */
  stability: number;
  /** Salud económica gruesa. */
  health: "broken" | "low" | "stable" | "rich";
}

/** Foto completa de la economía de un equipo (métricas + estado/risk de la decisión). */
export interface TeamEconomyView extends TeamMetrics {
  status: EconomyStatus | TeamMetrics["health"];
  risk: number;
  buy: BuyTier | null;
  lossBonus: number;
  bonus: boolean;
}

/** Decisión del Economy Engine (NUNCA compra armas: solo recomienda). */
export interface BuyDecision {
  tier: BuyTier;
  status: EconomyStatus;
  /** Riesgo asumido (0..1). */
  risk: number;
  // Respuestas a las preguntas clave:
  canFullBuy: boolean;
  shouldEco: boolean;
  forceWorth: boolean;
  shouldSave: boolean;
  /** Significado/etiquetas del porqué (no frases de UI). */
  reasons: string[];
}

/** Contexto de decisión (situación de partido, no economía). */
export interface BuyContext {
  matchPoint: boolean;
  opponentMatchPoint: boolean;
  /** Diferencia de marcador del equipo (propio - rival). */
  scoreDiff: number;
}

/** Registro económico de un equipo en una ronda (para historial/replay/análisis). */
export interface EconomyTeamRound {
  buy: BuyTier;
  status: EconomyStatus;
  risk: number;
  creditsBefore: number;
  spent: number;
  creditsAfter: number;
  reward: number;
  avg: number;
  min: number;
  max: number;
}

export interface EconomyRoundRecord {
  round: number;
  home: EconomyTeamRound;
  away: EconomyTeamRound;
  winner: TeamSlot;
}

/** Significado económico detectado por la narrativa (sin frases). */
export type EconomicEventType =
  | "eco_chain"
  | "economic_collapse"
  | "economic_comeback"
  | "decisive_force"
  | "bonus_won"
  | "perfect_buy"
  | "economic_error"
  | "economic_miracle";

export interface EconomicEvent {
  type: EconomicEventType;
  round: number;
  team: TeamSlot;
  /** Intensidad 0..100. */
  magnitude: number;
}

/** Estado COMPLETO de la economía del partido. */
export interface EconomyState {
  rules: EconomyRules;
  round: number;
  home: TeamEconomyState;
  away: TeamEconomyState;
  history: EconomyRoundRecord[];
  /** Significado económico (se rellena al terminar el partido). */
  events: EconomicEvent[];
}

/** Resultado de ronda que el Match Engine entrega para liquidar la economía. */
export interface RoundEconomyResult {
  winner: TeamSlot;
  /** Bajas por nombre de jugador (recompensa por baja). */
  kills: Record<string, number>;
}
