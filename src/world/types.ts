/**
 * LIVING ESPORTS WORLD — Tipos.
 *
 * El estado COMPLETO de un universo de esports que evoluciona solo: equipos, jugadores
 * (con desarrollo del Player Development Engine), contratos, transferencias, academia,
 * jubilaciones, rankings, mercado, fanbase, historia y narrativa. Reutiliza el Timeline
 * de `src/live` para la carrera/historia y los EcoEvent. Todo PLANO y clonable (persistible).
 */
import type { Region, RoleId } from "@/domain/cards/types";
import type { DevState, InnateProfile } from "@/development";
import type { Timeline } from "@/live/timeline";
import type { EcoEvent } from "@/live";
import type { NewsItem } from "@/intel";

export type SeasonPhase = "preseason" | "league" | "playoffs" | "masters" | "champions" | "market" | "offseason";

export type StaffRole = "coach" | "analista" | "caster" | "scout" | "manager" | "embajador";

/** Contrato de un jugador con un equipo. */
export interface Contract {
  salary: number;        // por temporada
  years: number;         // temporadas restantes
  releaseClause: number; // cláusula de rescisión
  happiness: number;     // 0..100
  loyalty: number;       // 0..100
  ambition: number;      // 0..100 (quiere ganar títulos)
  relCoach: number;      // 0..100 relación con el entrenador
  relTeam: number;       // 0..100 relación con el vestuario
}

export interface WorldPlayer {
  id: string;
  nick: string;
  region: Region;
  role: RoleId;
  teamId: string | null;  // null = agente libre
  innate: InnateProfile;
  dev: DevState;
  contract: Contract | null;
  status: "active" | "retired";
  staffRole?: StaffRole;   // al retirarse
  value: number;           // valor de mercado (créditos)
  titles: number;
  mvps: number;
  origin: "seed" | "academy";
  /** Valor de la temporada anterior (para detectar saltos / "the next star"). */
  prevValue: number;
}

export interface WorldCoach {
  id: string;
  name: string;
  teamId: string | null;
  rating: number;   // 0..100
  titles: number;
  seasons: number;
  fromPlayer?: string; // si nació de un jugador retirado
}

export interface SeasonStanding { season: number; pos: number; wins: number; losses: number; champion: boolean }

export interface WorldTeam {
  id: string;
  name: string;
  tag: string;
  region: Region;
  roster: string[];   // ids de jugadores
  coachId: string | null;
  budget: number;
  prestige: number;   // 0..100
  fanbase: number;    // popularidad (miles de fans)
  titles: number;
  /** Rival → intensidad 0..100. */
  rivalries: Record<string, number>;
  standings: SeasonStanding[];
}

export type TransferKind = "transfer" | "free" | "promotion" | "renewal" | "release" | "loan" | "loan_return" | "swap";
export interface Transfer {
  season: number;
  playerId: string;
  nick: string;
  from: string | null;
  to: string | null;
  fee: number;
  kind: TransferKind;
}

export interface RankRow { id: string; name: string; value: number; detail?: string }
export interface WorldRankings {
  players: RankRow[];
  teams: RankRow[];
  coaches: RankRow[];
  promises: RankRow[];
  veterans: RankRow[];
  rookies: RankRow[];
  regions: RankRow[];
}

export type WorldEventType =
  | "historic_dynasty" | "great_collapse" | "transfer_bomb" | "retirement" | "academy_wonderkid"
  | "legend_created" | "historic_rivalry" | "golden_generation" | "the_next_star" | "the_last_dance"
  | "coach_fired" | "coach_hired" | "record_transfer" | "perfect_season" | "perfect_split" | "historic_comeback";

export interface WorldEvent {
  type: WorldEventType;
  season: number;
  subject: string;   // equipo o jugador
  magnitude: number; // 1..100
  detail: string;
}

export interface RecordHolder { label: string; holder: string; value: number; season: number }
export interface WorldHistory {
  champions: { season: number; teamId: string; teamName: string }[];
  records: Record<string, RecordHolder>;
  rookieOfYear: { season: number; playerId: string; nick: string }[];
  retirements: { season: number; nick: string; staffRole: StaffRole }[];
}

export interface WorldState {
  seed: number;
  season: number;
  phase: SeasonPhase;
  teams: Record<string, WorldTeam>;
  players: Record<string, WorldPlayer>;
  coaches: Record<string, WorldCoach>;
  freeAgents: string[];
  freeCoaches: string[];
  timeline: Timeline;       // reutiliza src/live (carrera/historia/anti-dup)
  transfers: Transfer[];
  rankings: WorldRankings;
  events: WorldEvent[];
  ecoEvents: EcoEvent[];
  news: NewsItem[];
  history: WorldHistory;
  /** Contador determinista para ids de academia. */
  nextId: number;
}
