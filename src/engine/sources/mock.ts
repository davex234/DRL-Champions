import type {
  DataSource,
  RawTournament,
  RawTeam,
  RawMatch,
  RawResult,
  RawPlayerStat,
} from "../types";

/**
 * Fuente de datos SIMULADA con fixtures deterministas. Permite ejecutar todo el
 * pipeline del Data Engine sin red. La fuente real (VLR) implementa la misma
 * interfaz `DataSource`.
 */

const HOUR = 3600_000;

const TOURNAMENTS: RawTournament[] = [
  { id: "masters-toronto-2026", name: "Masters Toronto 2026", region: "International", status: "completed", endDate: "2026-06-20" },
  { id: "champions-paris-2026", name: "Champions Paris 2026", region: "International", status: "ongoing" },
];

const TEAMS: Record<string, RawTeam[]> = {
  "masters-toronto-2026": [
    { id: "lev", name: "Leviatán", tag: "LEV", region: "Americas" },
    { id: "sen", name: "Sentinels", tag: "SEN", region: "Americas" },
    { id: "fnc", name: "Fnatic", tag: "FNC", region: "EMEA" },
    { id: "prx", name: "Paper Rex", tag: "PRX", region: "Pacific" },
  ],
  "champions-paris-2026": [
    { id: "geng", name: "Gen.G", tag: "GENG", region: "Pacific" },
    { id: "edg", name: "EDward Gaming", tag: "EDG", region: "China" },
  ],
};

function stat(p: Partial<RawPlayerStat> & { playerId: string; nick: string; teamId: string }): RawPlayerStat {
  return { acs: 220, kills: 18, deaths: 15, assists: 5, hsPct: 26, clutches: 4, kast: 72, role: "Flex", country: "US", region: "Americas", ...p };
}

const MASTERS_STATS: RawPlayerStat[] = [
  // Leviatán (ganador) — aspas MVP
  stat({ playerId: "aspas", nick: "aspas", teamId: "lev", region: "Americas", role: "Duelista", country: "BR", acs: 285, kills: 24, deaths: 14, assists: 4, hsPct: 30, clutches: 9 }),
  stat({ playerId: "tex", nick: "Tex", teamId: "lev", region: "Americas", role: "Iniciador", country: "US", acs: 230, kills: 18, deaths: 15, assists: 7, clutches: 5 }),
  stat({ playerId: "kingg", nick: "kiNgg", teamId: "lev", region: "Americas", role: "Controlador", country: "BR", acs: 200, kills: 15, deaths: 16, assists: 9 }),
  stat({ playerId: "mazino", nick: "Mazino", teamId: "lev", region: "Americas", role: "Centinela", country: "AR", acs: 210, kills: 16, deaths: 15, assists: 6, clutches: 6 }),
  stat({ playerId: "c0m", nick: "C0M", teamId: "lev", region: "Americas", role: "Flex", country: "AR", acs: 215, kills: 17, deaths: 15, assists: 8 }),
  // Sentinels (finalista)
  stat({ playerId: "zekken", nick: "zekken", teamId: "sen", region: "Americas", role: "Duelista", country: "US", acs: 260, kills: 21, deaths: 16, assists: 5, hsPct: 24, clutches: 6 }),
  stat({ playerId: "tenz", nick: "TenZ", teamId: "sen", region: "Americas", role: "Duelista", country: "CA", acs: 255, kills: 20, deaths: 16, assists: 4, hsPct: 31 }),
  // Fnatic
  stat({ playerId: "derke", nick: "Derke", teamId: "fnc", region: "EMEA", role: "Duelista", country: "FI", acs: 258, kills: 22, deaths: 15, assists: 4, hsPct: 29, clutches: 7 }),
  stat({ playerId: "alfajer", nick: "Alfajer", teamId: "fnc", region: "EMEA", role: "Centinela", country: "TR", acs: 240, kills: 19, deaths: 14, assists: 8, hsPct: 27, clutches: 8 }),
  // Paper Rex
  stat({ playerId: "forsaken", nick: "f0rsakeN", teamId: "prx", region: "Pacific", role: "Flex", country: "ID", acs: 250, kills: 20, deaths: 15, assists: 7, hsPct: 26, clutches: 7 }),
];

export const mockSource: DataSource = {
  id: "mock",
  label: "Mock (fixtures)",

  async getTournaments() {
    return TOURNAMENTS;
  },

  async getTeams(tournamentId) {
    return TEAMS[tournamentId] ?? [];
  },

  async getMatches(tournamentId) {
    const now = Date.now();
    if (tournamentId === "masters-toronto-2026") {
      return [
        { id: "m-final", tournamentId, teamAId: "lev", teamBId: "sen", startTime: new Date(now - 2 * HOUR).toISOString(), status: "completed", scoreA: 3, scoreB: 1, winnerTeamId: "lev" },
        { id: "m-sf", tournamentId, teamAId: "fnc", teamBId: "prx", startTime: new Date(now - 6 * HOUR).toISOString(), status: "completed", scoreA: 2, scoreB: 3, winnerTeamId: "prx" },
      ] as RawMatch[];
    }
    // Champions en curso: un partido en vivo y uno próximo (scheduler + pick'ems)
    return [
      { id: "m-live", tournamentId, teamAId: "geng", teamBId: "edg", startTime: new Date(now - 20 * 60_000).toISOString(), status: "live", scoreA: 1, scoreB: 1 },
      { id: "m-next", tournamentId, teamAId: "edg", teamBId: "geng", startTime: new Date(now + 90 * 60_000).toISOString(), status: "upcoming" },
    ] as RawMatch[];
  },

  async getResult(tournamentId) {
    if (tournamentId !== "masters-toronto-2026") return null;
    return { tournamentId, winnerTeamId: "lev", mvpPlayerId: "aspas", stats: MASTERS_STATS };
  },
};
