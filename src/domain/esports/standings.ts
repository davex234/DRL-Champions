/**
 * DRL ESPORTS — cálculo puro de clasificaciones.
 *
 * Refleja en TypeScript la misma lógica que la RPC `recompute_standings` de la
 * migración 0003: permite calcular/ordenar standings en cliente (previews,
 * tests) sin ir a la base de datos. La fuente de verdad sigue siendo la RPC.
 */
import type { Match, Standing } from "./types";

const WIN_POINTS = 3;

interface Acc {
  teamId: string;
  stageId?: string;
  wins: number;
  losses: number;
  mapsWon: number;
  mapsLost: number;
  roundsWon: number;
  roundsLost: number;
}

/** Rondas por equipo de un partido (alineadas con teamA/teamB). */
export interface MatchRounds {
  matchId: string;
  roundsA: number;
  roundsB: number;
}

/**
 * Calcula las clasificaciones a partir de partidos finalizados. `rounds` es un
 * mapa opcional matchId → rondas por lado (de match_maps) para desempates.
 */
export function computeStandings(
  matches: Match[],
  rounds: Record<string, { a: number; b: number }> = {},
): Omit<Standing, "id" | "eventId">[] {
  const acc = new Map<string, Acc>();
  const key = (stageId: string | undefined, teamId: string) => `${stageId ?? "_"}::${teamId}`;

  const ensure = (stageId: string | undefined, teamId: string): Acc => {
    const k = key(stageId, teamId);
    let row = acc.get(k);
    if (!row) {
      row = { teamId, stageId, wins: 0, losses: 0, mapsWon: 0, mapsLost: 0, roundsWon: 0, roundsLost: 0 };
      acc.set(k, row);
    }
    return row;
  };

  for (const m of matches) {
    if (m.status !== "finished" || !m.teamAId || !m.teamBId) continue;
    const a = ensure(m.stageId, m.teamAId);
    const b = ensure(m.stageId, m.teamBId);
    const sa = m.scoreA ?? 0;
    const sb = m.scoreB ?? 0;
    a.mapsWon += sa; a.mapsLost += sb;
    b.mapsWon += sb; b.mapsLost += sa;
    if (m.winnerTeamId === m.teamAId) { a.wins++; b.losses++; }
    else if (m.winnerTeamId === m.teamBId) { b.wins++; a.losses++; }
    const r = rounds[m.id];
    if (r) {
      a.roundsWon += r.a; a.roundsLost += r.b;
      b.roundsWon += r.b; b.roundsLost += r.a;
    }
  }

  const rows = [...acc.values()].map((r) => ({
    stageId: r.stageId,
    teamId: r.teamId,
    wins: r.wins,
    losses: r.losses,
    ties: 0,
    mapsWon: r.mapsWon,
    mapsLost: r.mapsLost,
    mapDiff: r.mapsWon - r.mapsLost,
    roundsWon: r.roundsWon,
    roundsLost: r.roundsLost,
    roundDiff: r.roundsWon - r.roundsLost,
    points: r.wins * WIN_POINTS,
    status: "active" as const,
  }));

  // Orden por fase: puntos, diferencia de mapas, diferencia de rondas.
  const byStage = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byStage.get(row.stageId ?? "_") ?? [];
    list.push(row);
    byStage.set(row.stageId ?? "_", list);
  }
  const out: Omit<Standing, "id" | "eventId">[] = [];
  for (const list of byStage.values()) {
    list.sort((x, y) => y.points - x.points || y.mapDiff - x.mapDiff || y.roundDiff - x.roundDiff);
    list.forEach((row, i) => out.push({ ...row, position: i + 1 }));
  }
  return out;
}
