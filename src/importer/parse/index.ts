/**
 * PARSER ENGINE — CRUDO → estructura tipada y saneada.
 *
 * Separa el SCRAPING (Fase 2, detrás del provider) del PARSEO (aquí, puro): garantiza que existan
 * las colecciones, descarta entradas sin campos críticos (con issue `parse`) y no conoce el modelo
 * canónico (eso es del Normalizer). Determinista: mismo crudo ⇒ misma salida.
 */
import type {
  RawSnapshot, RawTournament, RawCircuit, RawStage, RawGroup, RawBracket, RawTeam, RawPlayer,
  RawCoach, RawRosterChange, RawMatch, RawMatchMap, RawMapPlayerStat, RawRound, RawStanding,
  RawAwards, RawPlayerTournamentStat, ImportIssue,
} from "../types";

export interface ParsedSnapshot {
  tournament: RawTournament;
  circuit?: RawCircuit;
  season?: { id?: string; name?: string; year?: number };
  stages: RawStage[];
  groups: RawGroup[];
  brackets: RawBracket[];
  teams: RawTeam[];
  players: RawPlayer[];
  coaches: RawCoach[];
  rosterChanges: RawRosterChange[];
  matches: RawMatch[];
  maps: RawMatchMap[];
  mapStats: RawMapPlayerStat[];
  playerTournamentStats: RawPlayerTournamentStat[];
  rounds: RawRound[];
  standings: RawStanding[];
  awards?: RawAwards;
}

export interface ParseOutput {
  snapshot: ParsedSnapshot;
  issues: ImportIssue[];
}

const arr = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

/** Sanea la ESTRUCTURA del snapshot crudo (sin normalizar aún). Descarta entradas inválidas. */
export function parseSnapshot(raw: RawSnapshot): ParseOutput {
  const issues: ImportIssue[] = [];
  const drop = (entity: string, ref: string, message: string): void => {
    issues.push({ kind: "parse", severity: "warning", entity, ref, message });
  };

  const teams = arr(raw.teams).filter((t) => {
    if (!t || typeof t.name !== "string" || !t.name.trim()) { drop("team", t?.id ?? "?", "equipo sin nombre"); return false; }
    return true;
  });
  const players = arr(raw.players).filter((p) => {
    if (!p || typeof p.nick !== "string" || !p.nick.trim()) { drop("player", p?.id ?? "?", "jugador sin nick"); return false; }
    return true;
  });
  const coaches = arr(raw.coaches).filter((c) => {
    if (!c || typeof c.name !== "string" || !c.name.trim()) { drop("coach", c?.id ?? "?", "coach sin nombre"); return false; }
    return true;
  });
  const matches = arr(raw.matches).filter((m) => {
    if (!m || !m.id) { drop("match", "?", "partido sin id"); return false; }
    if (!m.teamA || !m.teamB) { drop("match", m.id, "partido sin ambos equipos"); return false; }
    return true;
  });
  const maps = arr(raw.maps).filter((mm) => {
    if (!mm || !mm.id || !mm.matchId) { drop("map", mm?.id ?? "?", "mapa sin id/matchId"); return false; }
    return true;
  });
  const mapStats = arr(raw.mapStats).filter((s) => {
    if (!s || !s.matchMapId || !s.matchId || !s.player) { drop("mapStat", s?.id ?? "?", "stat sin refs"); return false; }
    return true;
  });
  /*
   * Un agregado de torneo sin jugador no se puede resolver contra nadie. Y `clutchesWon` sin
   * `clutchSituations` tampoco vale: la fuente publica una fracción, y quedarse solo con el
   * numerador cambiaría el significado del dato. En los dos casos se descarta con su aviso.
   */
  const playerTournamentStats = arr(raw.playerTournamentStats).filter((s) => {
    if (!s || !s.player) { drop("playerTournamentStat", "?", "agregado sin jugador"); return false; }
    if (s.clutchesWon !== undefined && s.clutchSituations === undefined) {
      drop("playerTournamentStat", s.player, "clutches sin denominador (situaciones jugadas)");
      return false;
    }
    return true;
  });
  const rounds = arr(raw.rounds).filter((r) => {
    if (!r || !r.matchMapId || typeof r.index !== "number") { drop("round", r?.id ?? "?", "ronda sin matchMapId/index"); return false; }
    return true;
  });

  const snapshot: ParsedSnapshot = {
    tournament: raw.tournament,
    circuit: raw.circuit,
    season: raw.season,
    stages: arr(raw.stages),
    groups: arr(raw.groups),
    brackets: arr(raw.brackets),
    teams,
    players,
    coaches,
    rosterChanges: arr(raw.rosterChanges),
    matches,
    maps,
    mapStats,
    playerTournamentStats,
    rounds,
    standings: arr(raw.standings),
    awards: raw.awards,
  };

  if (!raw.tournament || !raw.tournament.id || !raw.tournament.name) {
    issues.push({ kind: "parse", severity: "error", entity: "tournament", ref: raw.tournament?.id ?? "?", message: "torneo sin id/nombre" });
  }

  return { snapshot, issues };
}
