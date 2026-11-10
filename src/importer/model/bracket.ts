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
  /** Fase 24.4 · huecos, clasificación y procedencia (opcionales; ausentes = desconocido). */
  winnerToSlot?: 1 | 2;
  loserToSlot?: 1 | 2;
  winnerQualifies?: string;
  winnerQualifiesLabel?: string;
  evidence?: "SOURCE_EXPLICIT" | "SOURCE_BRACKET_LINK" | "SOURCE_STRUCTURED_HTML";
  confidence?: "CONFIRMED" | "INFERRED";
}

export interface Bracket {
  id: string;
  stageId: string;
  kind: BracketKind;
  nodes: BracketNode[];
}
