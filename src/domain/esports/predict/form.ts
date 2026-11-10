/**
 * DRL PREDICT — forma reciente, enfrentamiento directo y ventaja por mapas.
 * Funciones PURAS sobre los partidos ya normalizados (`@/domain/esports/types`).
 */
import type { Match } from "../types";
import type { FormSummary, HeadToHead } from "./types";

const EMPTY_FORM: FormSummary = { matches: 0, winRate: 0.5, mapWinRate: 0.5, momentum: 0 };

/** Partidos finalizados de un equipo, del más reciente al más antiguo. */
function finishedFor(matches: Match[], teamId: string): Match[] {
  return matches
    .filter((m) => m.status === "finished" && (m.teamAId === teamId || m.teamBId === teamId) && m.winnerTeamId)
    .sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
}

/** Resumen de forma a partir de los últimos `n` partidos del equipo. */
export function recentForm(matches: Match[], teamId: string, n = 10): FormSummary {
  const rows = finishedFor(matches, teamId).slice(0, n);
  if (!rows.length) return { ...EMPTY_FORM };

  let wins = 0, mapsWon = 0, mapsTotal = 0, wsum = 0, wnum = 0;
  rows.forEach((m, i) => {
    const isA = m.teamAId === teamId;
    const won = m.winnerTeamId === teamId;
    const for_ = (isA ? m.scoreA : m.scoreB) ?? 0;
    const against = (isA ? m.scoreB : m.scoreA) ?? 0;
    wins += won ? 1 : 0;
    mapsWon += for_;
    mapsTotal += for_ + against;
    // Peso por recencia: el más reciente pesa más (decaimiento exponencial).
    const w = Math.pow(0.85, i);
    wsum += w * (won ? 1 : -1);
    wnum += w;
  });

  return {
    matches: rows.length,
    winRate: wins / rows.length,
    mapWinRate: mapsTotal > 0 ? mapsWon / mapsTotal : 0.5,
    momentum: wnum > 0 ? wsum / wnum : 0,
  };
}

/** Balance directo entre A y B (partidos finalizados). */
export function headToHead(matches: Match[], a: string, b: string): HeadToHead {
  const rows = matches.filter(
    (m) => m.status === "finished" && m.winnerTeamId &&
      ((m.teamAId === a && m.teamBId === b) || (m.teamAId === b && m.teamBId === a)),
  );
  let gamesA = 0, gamesB = 0, mapDiffA = 0;
  for (const m of rows) {
    const aIsA = m.teamAId === a;
    const aScore = (aIsA ? m.scoreA : m.scoreB) ?? 0;
    const bScore = (aIsA ? m.scoreB : m.scoreA) ?? 0;
    mapDiffA += aScore - bScore;
    if (m.winnerTeamId === a) gamesA++; else gamesB++;
  }
  return { gamesA, gamesB, mapDiffA };
}

/**
 * Ventaja neta de A en el pool de mapas (-1..1), comparando el winrate por mapa
 * de cada equipo. `recordX[mapId] = { w, l }`.
 */
export function mapAdvantage(
  recordA: Record<string, { w: number; l: number }>,
  recordB: Record<string, { w: number; l: number }>,
): number {
  const maps = new Set([...Object.keys(recordA), ...Object.keys(recordB)]);
  if (!maps.size) return 0;
  const wr = (r?: { w: number; l: number }) => (r && r.w + r.l > 0 ? r.w / (r.w + r.l) : 0.5);
  let sum = 0;
  for (const id of maps) sum += wr(recordA[id]) - wr(recordB[id]);
  return Math.max(-1, Math.min(1, sum / maps.size));
}
