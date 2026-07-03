/**
 * RESULTADOS OBJETIVOS — awards y clasificación final de un torneo. Solo hechos objetivos
 * (campeón/subcampeón/MVP oficial/posiciones), sin premios de CARTA (eso es la fase de cartas).
 */
export interface Placement {
  /** 1 = campeón. */
  position: number;
  teamId: string;
  prize?: number;
  points?: number;
}

export interface ObjectiveAwards {
  tournamentId: string;
  championTeamId?: string;
  runnerUpTeamId?: string;
  /** MVP OFICIAL del torneo (editorial en la fuente; puede no ser el mejor rating). */
  mvpPlayerId?: string;
  placements: Placement[];
}
