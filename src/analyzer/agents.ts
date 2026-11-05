/**
 * AGENT METRICS (Fase 3) — agrega las `MapPlayerStat` POR AGENTE: por (jugador × agente) y pool
 * del torneo. Solo evidencia observada (stats sin `agentId` se omiten; nunca se inventa).
 * REUTILIZA `accumulate`/`kd`/`groupBy` de F2. Puro, determinista, O(n).
 */
import type { CanonicalModel, MapPlayerStat } from "@/importer";
import { accumulate, kd, groupBy } from "./aggregate";
import type { AgentMetrics, AgentUsage } from "./types";

const r = Math.round;
const r3 = (x: number): number => Math.round(x * 1000) / 1000;

/** Separador de clave compuesta (carácter de control: ningún id lo contiene). */
const SEP = "\u001f";

const isPlayed = (s: MapPlayerStat): s is MapPlayerStat & { playerId: string; agentId: string } =>
  typeof s.playerId === "string" && typeof s.agentId === "string";

/** ¿La stat-line pertenece a un mapa ganado por el equipo del jugador? (undefined si no hay dato). */
function wonMap(model: CanonicalModel, s: MapPlayerStat): boolean | undefined {
  const mm = model.index.mapById.get(s.matchMapId);
  if (!mm?.winnerTeamId || !s.teamId) return undefined;
  return mm.winnerTeamId === s.teamId;
}

export function computeAgentMetrics(model: CanonicalModel): { agents: AgentMetrics[]; pool: AgentUsage[] } {
  const withAgent = model.mapStats.filter(isPlayed);

  // Por (jugador × agente).
  const byPair = groupBy(withAgent, (s) => `${s.playerId}${SEP}${s.agentId}`);
  const agents: AgentMetrics[] = [];
  for (const [key, stats] of byPair) {
    const cut = key.indexOf(SEP);
    const playerId = key.slice(0, cut), agentId = key.slice(cut + 1);
    const l = accumulate(stats);
    let wins = 0, decided = 0;
    for (const s of stats) { const w = wonMap(model, s); if (w !== undefined) { decided++; if (w) wins++; } }
    agents.push({
      playerId, agentId, maps: l.maps, wins,
      winrate: r3(decided ? wins / decided : 0),
      acs: r(l.acs), adr: r(l.adr), kast: r(l.kast), kd: Math.round(kd(l) * 100) / 100,
      kills: l.kills, deaths: l.deaths, assists: l.assists, clutches: l.clutches,
    });
  }
  agents.sort((a, b) => a.playerId.localeCompare(b.playerId) || a.agentId.localeCompare(b.agentId));

  // Pool del torneo (por agente).
  const byAgent = groupBy(withAgent, (s) => s.agentId);
  const pool: AgentUsage[] = [];
  for (const [agentId, stats] of byAgent) {
    const l = accumulate(stats);
    let wins = 0, decided = 0;
    for (const s of stats) { const w = wonMap(model, s); if (w !== undefined) { decided++; if (w) wins++; } }
    pool.push({
      agentId, picks: stats.length,
      players: new Set(stats.map((s) => s.playerId)).size,
      winrate: r3(decided ? wins / decided : 0),
      acs: r(l.acs),
    });
  }
  pool.sort((a, b) => b.picks - a.picks || a.agentId.localeCompare(b.agentId));

  return { agents, pool };
}
