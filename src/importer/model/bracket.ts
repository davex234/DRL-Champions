/**
 * BRACKET OBJETIVO — estructura de eliminatoria de un torneo REAL (distinta del `Bracket` del
 * motor de simulación en `src/tournament/`, que es interno del juego). Solo datos objetivos.
 */
export type BracketKind = "single-elim" | "double-elim" | "gsl" | "swiss" | "round-robin";

/** Nodo del bracket: un enfrentamiento y hacia dónde avanzan ganador/perdedor. */
export interface BracketNode {
  id: string;
  /** Profundidad de ronda (0 = final; números mayores = rondas más tempranas). */
  round: number;
  slot: number;
  matchId?: string;
  winnerToNodeId?: string;
  loserToNodeId?: string;
}

export interface Bracket {
  id: string;
  stageId: string;
  kind: BracketKind;
  nodes: BracketNode[];
}
