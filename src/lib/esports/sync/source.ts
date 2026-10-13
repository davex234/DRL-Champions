/**
 * DRL ESPORTS SYNC — contrato de fuente de datos competitiva.
 *
 * Amplía la idea del `DataSource` del DRL Data Engine (`@/engine/types`) con el
 * detalle que necesita el sistema VLR-style: jerarquía de circuitos, fases,
 * detalle de partido por mapas y scoreboard por jugador, y clasificaciones.
 *
 * REGLA (igual que el engine): los datos crudos (`Raw*`) NUNCA se escriben tal
 * cual; siempre pasan por `mappers.ts` (Raw → fila SQL normalizada).
 */
import type { MatchStatus } from "@/domain/esports/types";

export interface RawCircuit {
  id: string;
  name: string;
  tier?: string;
  region?: string;
  scope?: string;
  parentCircuitId?: string;
}

export interface RawTournament {
  id: string;
  name: string;
  type?: string;
  circuitId?: string;
  tier?: string;
  region?: string;
  status?: string;
  slug?: string;
  prizePool?: number;
  location?: string;
  country?: string;
  startDate?: string;
  endDate?: string;
  vlrUrl?: string;
}

export interface RawStage {
  slug: string;
  name: string;
  kind?: string;
  orderIdx?: number;
}

export interface RawTeam {
  id: string;
  name: string;
  tag?: string;
  fullName?: string;
  region?: string;
  country?: string;
  logo?: string;
}

export interface RawMapPlayer {
  playerId: string;
  nick?: string;
  teamId: string;
  agentId?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  acs?: number;
  combatScore?: number;
  damage?: number;
  rounds?: number;
  /**
   * ADR ya por ronda. Algunas fuentes (vlr.gg) lo publican medido y NO dan daño total ni
   * rondas por mapa; sin este campo el valor real se perdería y el mapper devolvería null.
   */
  adr?: number;
  kast?: number;
  hsPct?: number;
  fk?: number;
  fd?: number;
  clutches?: number;
}

export interface RawMatchMap {
  mapId?: string;
  mapOrder: number;
  scoreA?: number;
  scoreB?: number;
  winnerTeamId?: string;
  pickedBy?: string;
  sideStart?: string;
  duration?: number;
  players?: RawMapPlayer[];
}

/**
 * Fase 24.4 · adónde va el ganador / el perdedor de un partido, SOLO cuando la fuente lo
 * confirma. Ausente = desconocido (y así se queda: nada se infiere aquí).
 */
export interface MatchProgression {
  winnerTo?: { matchId: string; slot?: 1 | 2 };
  loserTo?: { matchId: string; slot?: 1 | 2 };
  winnerQualifies?: { key: string; label?: string };
  evidence: "SOURCE_EXPLICIT" | "SOURCE_BRACKET_LINK" | "SOURCE_STRUCTURED_HTML";
  confidence: "CONFIRMED";
  version?: string;
}

export interface RawMatch {
  id: string;
  eventId: string;
  /** Fase 24.4 · estructura confirmada del cuadro (opcional). */
  progression?: MatchProgression;
  stageSlug?: string;
  teamAId: string;
  teamBId: string;
  startTime?: string; // ISO
  status?: string;
  format?: string;
  bestOf?: number;
  round?: string;
  matchOrder?: number;
  scoreA?: number;
  scoreB?: number;
  winnerTeamId?: string;
  mvpPlayerId?: string;
  patch?: string;
  vodUrl?: string;
  vlrUrl?: string;
  maps?: RawMatchMap[];
}

export interface RawStanding {
  stageSlug?: string;
  teamId: string;
  position?: number;
  groupLabel?: string;
  status?: string;
}

export function normalizeStatus(s: string | undefined): MatchStatus {
  if (s === "live" || s === "ongoing") return "live";
  if (s === "finished" || s === "completed" || s === "final") return "finished";
  return "upcoming";
}

/** Cualquier fuente competitiva (VLR proxy, mock, API oficial…). */
export interface CompetitiveSource {
  id: string;
  label: string;
  getCircuits(): Promise<RawCircuit[]>;
  getTournaments(circuitId?: string): Promise<RawTournament[]>;
  getTournament(id: string): Promise<RawTournament | null>;
  getStages(tournamentId: string): Promise<RawStage[]>;
  getTeams(tournamentId: string): Promise<RawTeam[]>;
  /** Partidos del torneo (resumen; los `maps` pueden venir vacíos). */
  getMatches(tournamentId: string): Promise<RawMatch[]>;
  /** Detalle de un partido CON mapas y scoreboard por jugador. */
  getMatchDetail(matchId: string): Promise<RawMatch | null>;
  getStandings(tournamentId: string): Promise<RawStanding[]>;
}

const BASE = process.env.NEXT_PUBLIC_VLR_API;

async function get<T>(path: string): Promise<T> {
  if (!BASE) throw new Error("VLR no configurado (NEXT_PUBLIC_VLR_API)");
  const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`VLR ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Adaptador VLR.gg — espera que el proxy `NEXT_PUBLIC_VLR_API` devuelva ya las
 * formas `Raw*` de este módulo (mismo criterio que `@/engine/sources/vlr`).
 * Si el proxy no está configurado, cada método lanza y el orquestador puede
 * caer a la fuente mock.
 */
export const vlrSource: CompetitiveSource = {
  id: "vlr",
  label: "VLR.gg",
  getCircuits: () => get("/circuits"),
  getTournaments: (c) => get(c ? `/circuits/${c}/events` : "/events"),
  getTournament: (id) => get(`/events/${id}`),
  getStages: (t) => get(`/events/${t}/stages`),
  getTeams: (t) => get(`/events/${t}/teams`),
  getMatches: (t) => get(`/events/${t}/matches`),
  getMatchDetail: (m) => get(`/matches/${m}`),
  getStandings: (t) => get(`/events/${t}/standings`),
};

export function isVlrConfigured(): boolean {
  return Boolean(BASE);
}
