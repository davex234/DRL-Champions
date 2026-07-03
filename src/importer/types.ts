/**
 * TIPOS DEL DATA IMPORT ENGINE (Fase 1/7).
 *
 * `Raw*` = forma CRUDA que entregaría un proveedor (ids/fechas como string, campos opcionales). El
 * pipeline la convierte en el MODELO CANÓNICO (`@/importer/model`, que reutiliza `domain/esports`).
 * Sin cartas, sin OVR, sin economía: solo datos objetivos.
 */
import type {
  Circuit, Tournament, Stage, ProTeam, ProPlayer, Match, MatchMap, MapPlayerStat, Standing,
  Season, Group, Bracket, Round, ProCoach, Roster, ObjectiveAwards,
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
export interface RawBracketNode { id: string; round: number; slot?: number; matchId?: string; winnerToNodeId?: string; loserToNodeId?: string }
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
