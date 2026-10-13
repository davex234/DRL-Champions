/**
 * TIPOS DEL DATA IMPORT ENGINE (Fase 1/7).
 *
 * `Raw*` = forma CRUDA que entregaría un proveedor (ids/fechas como string, campos opcionales). El
 * pipeline la convierte en el MODELO CANÓNICO (`@/importer/model`, que reutiliza `domain/esports`).
 * Sin cartas, sin OVR, sin economía: solo datos objetivos.
 */
import type {
  Circuit, Tournament, Stage, ProTeam, ProPlayer, Match, MatchMap, MapPlayerStat, Standing,
  Season, Group, Bracket, Round, ProCoach, Roster, ObjectiveAwards, PlayerTournamentStat,
} from "./model";
import type { ImportClock } from "./clock";
import type { IdentityResolver } from "./identity";

export const IMPORTER_SCHEMA_VERSION = 1;

// ── Entrada cruda (lo que un provider de Fase 2 devolvería) ──
export interface RawEntityRef { id?: string; name: string; realName?: string }

export interface RawTournament {
  id: string; name: string; type?: string; circuitId?: string; tier?: string; region?: string;
  status?: string; slug?: string; prizePool?: number; location?: string; country?: string;
  startDate?: string; endDate?: string; year?: number;
}
export interface RawCircuit { id: string; name: string; tier?: string; region?: string; scope?: string }
export interface RawStage { id: string; slug?: string; name: string; kind?: string; orderIdx?: number }
export interface RawGroup { id: string; stageId: string; label: string; teams: string[] }
export interface RawBracketNode {
  id: string; round: number; slot?: number; matchId?: string; winnerToNodeId?: string; loserToNodeId?: string;
  /** Fase 24.4 · hueco que ocupa el ganador/perdedor en el nodo destino, si la fuente lo dice. */
  winnerToSlot?: 1 | 2; loserToSlot?: 1 | 2;
  /** Fase 24.4 · el ganador se clasifica (clave + etiqueta del nodo de clasificación). */
  winnerQualifies?: string; winnerQualifiesLabel?: string;
  /** Fase 24.4 · de dónde sale la relación y cuánto se afirma. */
  evidence?: "SOURCE_EXPLICIT" | "SOURCE_BRACKET_LINK" | "SOURCE_STRUCTURED_HTML";
  confidence?: "CONFIRMED" | "INFERRED";
}
export interface RawBracket { id: string; stageId: string; kind?: string; nodes: RawBracketNode[] }
export interface RawTeam { id?: string; name: string; tag?: string; fullName?: string; region?: string; country?: string; slug?: string; active?: boolean }
export interface RawPlayer { id?: string; nick: string; fullName?: string; team?: string; region?: string; role?: string; country?: string; status?: string; agents?: string[]; isSubstitute?: boolean }
export interface RawCoach { id?: string; name: string; fullName?: string; team?: string; region?: string; country?: string; status?: string }
export interface RawRosterChange { id?: string; team: string; player: string; role?: string; joinedAt?: string; leftAt?: string; isActive?: boolean }
export interface RawMatch { id: string; stageId?: string; teamA: string; teamB: string; startTime?: string; status?: string; format?: string; bestOf?: number; round?: string; matchOrder?: number; scoreA?: number; scoreB?: number; winner?: string; mvp?: string }
export interface RawMatchMap { id: string; matchId: string; map?: string; mapOrder?: number; scoreA?: number; scoreB?: number; winner?: string; pickedBy?: string }
export interface RawMapPlayerStat { id?: string; matchMapId: string; matchId: string; player: string; team?: string; agent?: string; acs?: number; kills?: number; deaths?: number; assists?: number; kast?: number; adr?: number; hsPct?: number; fk?: number; fd?: number; clutches?: number; rating?: number }
export interface RawRound { id?: string; matchMapId: string; index: number; winner?: string; side?: string; type?: string; plant?: boolean; defuse?: boolean }
export interface RawStanding { id?: string; stageId?: string; team: string; position?: number; wins?: number; losses?: number; ties?: number; mapsWon?: number; mapsLost?: number; roundsWon?: number; roundsLost?: number; points?: number; groupLabel?: string; status?: string }
/**
 * Agregado de UN jugador en TODO el torneo — para lo que la fuente no publica por mapa.
 *
 * No duplica `RawMapPlayerStat`: existe para los datos cuya única granularidad publicada es
 * el torneo. Hoy eso es exactamente uno, el clutch: vlr.gg lo da en `/event/stats/` y su
 * scoreboard por mapa no tiene columna equivalente. Repartir el agregado entre los mapas
 * para hacerlo caber en `mapStats` sería inventar estadísticas por mapa que nadie ha
 * publicado; por eso viaja por su propio carril y con su granularidad real.
 *
 * `clutchesWon` son situaciones de clutch GANADAS y `clutchSituations` las jugadas. Las dos
 * o ninguna: un recuento sin denominador no es la estadística de la fuente.
 */
export interface RawPlayerTournamentStat {
  player: string;
  team?: string;
  maps?: number;
  rounds?: number;
  clutchesWon?: number;
  clutchSituations?: number;
  clutchPct?: number;
}
export interface RawPlacement { position: number; team: string; prize?: number; points?: number }
export interface RawAwards { champion?: string; runnerUp?: string; mvp?: string; placements?: RawPlacement[] }

/** Snapshot crudo de UN torneo (fuente-agnóstico). Solo `tournament`+`teams`+`players`+`matches` son requeridos. */
export interface RawSnapshot {
  tournament: RawTournament;
  circuit?: RawCircuit;
  season?: { id?: string; name?: string; year?: number };
  stages?: RawStage[];
  groups?: RawGroup[];
  brackets?: RawBracket[];
  teams: RawTeam[];
  players: RawPlayer[];
  coaches?: RawCoach[];
  rosterChanges?: RawRosterChange[];
  matches: RawMatch[];
  maps?: RawMatchMap[];
  mapStats?: RawMapPlayerStat[];
  /** Agregados por jugador y torneo (solo lo que la fuente no publica por mapa). */
  playerTournamentStats?: RawPlayerTournamentStat[];
  rounds?: RawRound[];
  standings?: RawStanding[];
  awards?: RawAwards;
}

// ── Modelo canónico normalizado ──
export interface CanonicalIndex {
  teamById: Map<string, ProTeam>;
  playerById: Map<string, ProPlayer>;
  coachById: Map<string, ProCoach>;
  matchById: Map<string, Match>;
  mapById: Map<string, MatchMap>;
}

/** Modelo canónico de UN torneo (solo datos objetivos). Índices `Map` O(1) para validación/consulta. */
export interface CanonicalModel {
  schemaVersion: number;
  circuit?: Circuit;
  season?: Season;
  tournament: Tournament;
  stages: Stage[];
  groups: Group[];
  brackets: Bracket[];
  teams: ProTeam[];
  players: ProPlayer[];
  coaches: ProCoach[];
  rosters: Roster[];
  matches: Match[];
  maps: MatchMap[];
  mapStats: MapPlayerStat[];
  /** Agregados por jugador y torneo. Vacío si la fuente no publica ninguno. */
  playerTournamentStats: PlayerTournamentStat[];
  rounds: Round[];
  standings: Standing[];
  awards?: ObjectiveAwards;
  index: CanonicalIndex;
}

// ── Diagnóstico ──
export type IssueSeverity = "error" | "warning" | "info";
export type IssueKind = "parse" | "schema" | "identity" | "reference" | "duplicate" | "consistency" | "version";
export interface ImportIssue {
  kind: IssueKind;
  severity: IssueSeverity;
  entity: string;
  ref?: string;
  message: string;
}

/** Contexto inyectado — SIN estado global: reloj, resolutor de identidad y versión de esquema. */
export interface ImportCtx {
  clock: ImportClock;
  identity: IdentityResolver;
  schemaVersion?: number;
}

export interface ImportResult {
  /** No hay issues de severidad "error". */
  ok: boolean;
  model: CanonicalModel;
  issues: ImportIssue[];
}
