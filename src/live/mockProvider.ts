/**
 * LIVE ECOSYSTEM — Proveedor MOCK (fixtures deterministas).
 *
 * Implementa `LiveDataProvider` con datos reproducibles para correr el ecosistema y el
 * harness en LOCAL (sin red). Factory configurable: salud, prioridad y escenarios
 * (incluidos alias de un mismo jugador desde "otra fuente", para probar la identidad).
 */
import type { RawTournament, RawTeam, RawMatch, RawResult, RawPlayerStat } from "@/engine/types";
import type { LiveDataProvider, ProviderHealth } from "./provider";
import { ns } from "@/i18n/runtime";

const tr = ns("live");

export interface MockTournament {
  tournament: RawTournament;
  teams: RawTeam[];
  matches: RawMatch[];
  result: RawResult | null;
}

export interface MockProviderOpts {
  id: string;
  priority: number;
  healthy?: boolean;
  game?: string;
  tournaments: MockTournament[];
}

export function makeMockProvider(opts: MockProviderOpts): LiveDataProvider {
  const game = opts.game ?? "valorant";
  const find = (id: string) => opts.tournaments.find((t) => t.tournament.id === id);
  return {
    id: opts.id,
    priority: () => opts.priority,
    supports: (g) => g === game,
    health: async (): Promise<ProviderHealth> => (opts.healthy === false ? { ok: false, error: tr("fuente caída") } : { ok: true, latencyMs: 12 }),
    discover: async () => opts.tournaments.map((t) => t.tournament),
    fetchTournament: async (id) => find(id)?.tournament ?? null,
    fetchTeams: async (id) => find(id)?.teams ?? [],
    fetchMatches: async (id) => find(id)?.matches ?? [],
    fetchResult: async (id) => find(id)?.result ?? null,
  };
}

// --- Helpers de fixtures ---
const stat = (playerId: string, nick: string, teamId: string, over: Partial<RawPlayerStat> = {}): RawPlayerStat => ({
  playerId, nick, teamId, region: "EMEA", role: "Duelista", country: "es",
  acs: 230, kills: 18, deaths: 15, assists: 6, hsPct: 28, clutches: 1, kast: 72, ...over,
});

/** Un Champions 2025 finalizado (con MVP clutch) — fixture por defecto. */
export function defaultFixtures(): MockTournament[] {
  const teams: RawTeam[] = [
    { id: "tA", name: "Fnatic", tag: "FNC", region: "EMEA" },
    { id: "tB", name: "Sentinels", tag: "SEN", region: "Americas" },
  ];
  const result: RawResult = {
    tournamentId: "champ2025", winnerTeamId: "tA", mvpPlayerId: "p_tenz",
    stats: [
      stat("p_tenz", "TenZ", "tB", { acs: 300, kills: 26, deaths: 14, clutches: 5, hsPct: 34, kast: 82 }),
      stat("p_derke", "Derke", "tA", { acs: 285, kills: 24, deaths: 15, clutches: 3, kast: 80 }),
      stat("p_boaster", "Boaster", "tA", { acs: 180, kills: 12, deaths: 16, assists: 11, role: "Iniciador", clutches: 0 }),
      stat("p_alfajer", "Alfajer", "tA", { acs: 240, kills: 19, deaths: 14, role: "Centinela", clutches: 2 }),
      stat("p_chronicle", "Chronicle", "tA", { acs: 235, kills: 18, deaths: 15, role: "Iniciador" }),
    ],
  };
  return [{
    tournament: { id: "champ2025", name: "Champions 2025", region: "Global", status: "completed", startDate: "2025-08-01", endDate: "2025-08-24" },
    teams,
    matches: [{ id: "m1", tournamentId: "champ2025", teamAId: "tA", teamBId: "tB", startTime: "2025-08-24T18:00:00Z", status: "completed", scoreA: 3, scoreB: 2, winnerTeamId: "tA" }],
    result,
  }];
}
