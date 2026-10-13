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

/**
 * AGREGADO DE UN JUGADOR EN UN TORNEO — solo para lo que la fuente no publica por mapa.
 *
 * Contrapartida canónica de `RawPlayerTournamentStat`. Deliberadamente NO replica el trío de
 * `MapPlayerStat`: si un dato existe por mapa, su sitio es `mapStats` y la suma se hace en el
 * analyzer. Aquí solo vive lo que únicamente existe agregado — hoy, el clutch de vlr.gg.
 */
export interface PlayerTournamentStat {
  tournamentId: string;
  playerId: string;
  teamId?: string;
  maps?: number;
  rounds?: number;
  /** Situaciones de clutch GANADAS en todo el torneo. */
  clutchesWon?: number;
  /** Situaciones de clutch JUGADAS en todo el torneo (el denominador). */
  clutchSituations?: number;
  /** Porcentaje de acierto, tal y como lo publica la fuente. */
  clutchPct?: number;
}

export interface ObjectiveAwards {
  tournamentId: string;
  championTeamId?: string;
  runnerUpTeamId?: string;
  /** MVP OFICIAL del torneo (editorial en la fuente; puede no ser el mejor rating). */
  mvpPlayerId?: string;
  placements: Placement[];
}
