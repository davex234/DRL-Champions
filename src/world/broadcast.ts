/**
 * MUNDO × BROADCAST — DATOS para mostrar el universo: standings, rankings, transferencias,
 * noticias, temporadas, academias, contratos, fanbase, historia y timeline. PURO (solo lee).
 */
import type { WorldState, WorldRankings, Transfer, WorldEvent } from "./types";
import type { NewsItem } from "@/intel";
import { worldChronicle } from "./history";

export interface TeamRow {
  id: string; name: string; tag: string; region: string;
  pos: number; wins: number; losses: number; prestige: number; fanbase: number; titles: number;
}

export interface WorldBroadcast {
  season: number;
  phase: string;
  standings: TeamRow[];
  rankings: WorldRankings;
  recentTransfers: Transfer[];
  recentNews: NewsItem[];
  recentEvents: WorldEvent[];
  champions: { season: number; teamName: string }[];
  chronicle: string[];
  counts: { teams: number; activePlayers: number; retired: number; freeAgents: number; coaches: number };
}

export function worldBroadcast(world: WorldState): WorldBroadcast {
  const teams = Object.values(world.teams);
  const standings: TeamRow[] = teams.map((t) => {
    const last = t.standings[t.standings.length - 1];
    return {
      id: t.id, name: t.name, tag: t.tag, region: t.region,
      pos: last?.pos ?? 99, wins: last?.wins ?? 0, losses: last?.losses ?? 0,
      prestige: Math.round(t.prestige), fanbase: t.fanbase, titles: t.titles,
    };
  }).sort((a, b) => a.pos - b.pos);

  const players = Object.values(world.players);
  return {
    season: world.season,
    phase: world.phase,
    standings,
    rankings: world.rankings,
    recentTransfers: world.transfers.filter((t) => t.season === world.season - 1).slice(0, 20),
    recentNews: world.news.slice(0, 12),
    recentEvents: world.events.slice(0, 12),
    champions: world.history.champions.slice(-8).map((c) => ({ season: c.season, teamName: c.teamName })),
    chronicle: worldChronicle(world),
    counts: {
      teams: teams.length,
      activePlayers: players.filter((p) => p.status === "active").length,
      retired: players.filter((p) => p.status === "retired").length,
      freeAgents: world.freeAgents.length,
      coaches: Object.keys(world.coaches).length,
    },
  };
}
