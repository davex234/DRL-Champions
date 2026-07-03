/**
 * DRL ESPORTS SYNC — fuente MOCK para desarrollo y pruebas end-to-end.
 *
 * Provee un torneo de ejemplo con equipos, una fase, un partido finalizado con
 * dos mapas y scoreboard por jugador. Permite ejecutar `runCompetitiveSync`
 * sin red y comprobar que se pueblan match_maps / map_player_stats y que las
 * RPC recomputan standings / team_stats / player_event_stats.
 */
import type {
  CompetitiveSource, RawCircuit, RawTournament, RawStage, RawTeam, RawMatch, RawStanding, RawMapPlayer,
} from "./source";

const CIRCUITS: RawCircuit[] = [
  { id: "vct-emea", name: "VCT EMEA", tier: "vct-international", region: "EMEA", scope: "international" },
];

const TOURNAMENT: RawTournament = {
  id: "vct-emea-2026-s1", name: "VCT EMEA 2026 — Etapa 1", type: "regional",
  circuitId: "vct-emea", tier: "vct-international", region: "EMEA", status: "finished",
  slug: "vct-emea-2026-s1", prizePool: 250000, location: "Berlín", country: "Alemania",
  startDate: "2026-03-01", endDate: "2026-04-15",
};

const TEAMS: RawTeam[] = [
  { id: "th", name: "Team Heretics", tag: "TH", region: "EMEA", country: "España" },
  { id: "fnc", name: "Fnatic", tag: "FNC", region: "EMEA", country: "Reino Unido" },
];

const STAGES: RawStage[] = [
  { slug: "playoffs", name: "Playoffs", kind: "playoff", orderIdx: 0 },
];

// Línea de scoreboard sintética por jugador.
function line(playerId: string, teamId: string, agentId: string, k: number, d: number, a: number, rounds: number): RawMapPlayer {
  return {
    playerId, teamId, agentId, kills: k, deaths: d, assists: a, rounds,
    combatScore: Math.round((k * 200 + a * 40) ), damage: Math.round((k * 150 + 40) * rounds / Math.max(rounds, 1)),
    kast: 70 + (k - d), hsPct: 25 + (k % 10), fk: Math.max(0, Math.round(k / 6)), fd: Math.max(0, Math.round(d / 8)), clutches: k % 3,
  };
}

const TH = ["benjyfishy", "miniboo", "wo0t", "rieNs", "boo"];
const FNC = ["boaster", "derke", "alfajer", "leo", "crashies"];

function mapPlayers(scoreA: number, scoreB: number, rounds: number): RawMapPlayer[] {
  const agents = ["jett", "sova", "killjoy", "omen", "breach"];
  const out: RawMapPlayer[] = [];
  TH.forEach((p, i) => out.push(line(p, "th", agents[i], 18 - i + (scoreA > scoreB ? 3 : 0), 14 + i, 5, rounds)));
  FNC.forEach((p, i) => out.push(line(p, "fnc", agents[i], 18 - i + (scoreB > scoreA ? 3 : 0), 14 + i, 5, rounds)));
  return out;
}

const MATCH: RawMatch = {
  id: "vct-emea-2026-s1-gf", eventId: TOURNAMENT.id, stageSlug: "playoffs",
  teamAId: "th", teamBId: "fnc", startTime: "2026-04-15T17:00:00Z", status: "finished",
  format: "bo3", bestOf: 3, round: "Gran Final", matchOrder: 1,
  scoreA: 2, scoreB: 1, winnerTeamId: "th", mvpPlayerId: "benjyfishy",
  maps: [
    { mapId: "ascent", mapOrder: 1, scoreA: 13, scoreB: 9, pickedBy: "th", players: mapPlayers(13, 9, 22) },
    { mapId: "bind", mapOrder: 2, scoreA: 11, scoreB: 13, pickedBy: "fnc", players: mapPlayers(11, 13, 24) },
    { mapId: "lotus", mapOrder: 3, scoreA: 13, scoreB: 10, pickedBy: "th", players: mapPlayers(13, 10, 23) },
  ],
};

const STANDINGS: RawStanding[] = [
  { stageSlug: "playoffs", teamId: "th", position: 1, status: "qualified" },
  { stageSlug: "playoffs", teamId: "fnc", position: 2, status: "eliminated" },
];

export const mockSource: CompetitiveSource = {
  id: "mock",
  label: "Mock (desarrollo)",
  getCircuits: async () => CIRCUITS,
  getTournaments: async () => [TOURNAMENT],
  getTournament: async (id) => (id === TOURNAMENT.id ? TOURNAMENT : null),
  getStages: async () => STAGES,
  getTeams: async () => TEAMS,
  getMatches: async () => [MATCH],
  getMatchDetail: async (id) => (id === MATCH.id ? MATCH : null),
  getStandings: async () => STANDINGS,
};
