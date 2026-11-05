/**
 * TOURNAMENT — vocabulario compartido (Online Fase 6/7).
 *
 * Infraestructura competitiva profesional: brackets (single/double elim, swiss, round robin,
 * groups→playoffs), series BO1..BO7, seeding, lifecycle, admin, awards, circuit points. Los
 * partidos se juegan con el ÚNICO Gameplay (reusa makeMatchConfig/simulateMatch/Online); el
 * torneo solo orquesta fixtures. Flujo: Tournament→Bracket→Match(config)→Gameplay→Competitive→
 * Replay→Presentation. Depende de match/online/competitive/replay (nunca al revés). DETERMINISTA.
 */
import type { Region } from "@/domain/cards/types";
import type { RosterEntry } from "@/sim";

export type TournamentFormat = "single_elim" | "double_elim" | "swiss" | "round_robin" | "groups";
export type SeedMethod = "random" | "rank" | "regional" | "protected";
export type SeriesFormat = "bo1" | "bo3" | "bo5" | "bo7";
export type TournamentTier = "regional" | "minor" | "major" | "worlds" | "season_finals";
export type TournamentStatus = "registration" | "checkin" | "seeding" | "group" | "playoff" | "live" | "finished";

export interface Team {
  id: string;
  name: string;
  region: Region;
  seed: number;              // 1 = mejor (asignado por el Seed Engine)
  rating: number;            // MMR/Elo (reutilizado de Competitive)
  roster: RosterEntry[] | null;
  status: "active" | "eliminated" | "champion" | "disqualified";
  checkedIn: boolean;
  wins: number;
  losses: number;
  placement: number | null;
}

// ───────────────────────────── Series (BO) + mapas ─────────────────────────────

export interface MapResult { index: number; map: string; seed: number; winner: "A" | "B"; scoreHome: number; scoreAway: number; matchId: string }
export interface MapVeto { pool: string[]; bans: { team: "A" | "B"; map: string }[]; picks: { team: "A" | "B"; map: string }[]; decider: string | null }
export interface SeriesState { format: SeriesFormat; target: number; scoreA: number; scoreB: number; maps: MapResult[]; veto: MapVeto | null }

// ───────────────────────────── Fixtures / bracket ─────────────────────────────

export type FixtureStage = "group" | "rr" | "swiss" | "upper" | "lower" | "playoff" | "semifinal" | "final" | "grandfinal" | "bronze";
export type FixtureStatus = "pending" | "ready" | "live" | "done" | "walkover" | "bye";
export interface Advancement { fixtureId: string; slot: "A" | "B" }

export interface Fixture {
  id: string;
  stage: FixtureStage;
  round: number;
  group: string | null;
  slotA: string | null;      // team id (null = TBD)
  slotB: string | null;
  series: SeriesState;
  winner: string | null;     // team id
  loser: string | null;
  status: FixtureStatus;
  winnerTo: Advancement | null;
  loserTo: Advancement | null;   // double elim
  label: string;
}

export interface Bracket {
  format: TournamentFormat;
  fixtures: Record<string, Fixture>;
  order: string[];           // ids en orden de disputa
  rounds: number;
  groups: Record<string, string[]>;   // group → teamIds
  finalId: string | null;    // fixture que corona (single/double elim); null en rr/swiss/groups
}

// ───────────────────────────── Resultado / play function ─────────────────────────────

/** Resultado de UN mapa (lo produce el Gameplay). `winner` = slot A/B. */
export interface MapOutcome { winner: "A" | "B"; scoreHome: number; scoreAway: number; matchId: string }
/** Juega un mapa entre dos equipos (reutiliza el Gameplay: simulateMatch/Online). DETERMINISTA. */
export type PlayFn = (ctx: { fixture: Fixture; teamA: Team; teamB: Team; mapIndex: number; mapSeed: number; map: string }) => MapOutcome;

// ───────────────────────────── Awards / circuit ─────────────────────────────

export interface TournamentAwards { championId: string | null; runnerUpId: string | null; thirdId: string | null; mvpTeamId: string | null }
export interface CircuitStanding { teamId: string; name: string; points: number; best: number | null }
export interface TournamentRecord { label: string; holder: string; value: number }

export interface TournamentEvent { type: string; at: number; data?: unknown }
