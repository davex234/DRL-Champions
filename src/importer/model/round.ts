/**
 * ROUND — dato objetivo POR RONDA (la granularidad que faltaba: el mínimo objetivo previo era
 * `MatchMap`). Hijo de un `MatchMap`. Solo hechos objetivos (ganador/lado/tipo de compra/plant).
 */
export type RoundType = "pistol" | "eco" | "force" | "buy" | "bonus" | "unknown";

export interface Round {
  id: string;
  matchMapId: string;
  /** Índice 1-based dentro del mapa. */
  index: number;
  winnerTeamId?: string;
  side?: "attack" | "defense";
  type?: RoundType;
  plant?: boolean;
  defuse?: boolean;
}
