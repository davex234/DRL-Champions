/**
 * FIXTURES QA SYNTHETIC · F84 — solo para el arnés `/design-system/f84` y sus capturas. Jugadores, ratings y partidas
 * INVENTADOS y etiquetados; las cifras de rango/colocación salen de las MISMAS funciones puras que usa el servidor
 * (`deriveRank`, `competitiveStanding`, `rankMovement`). Nunca se escriben ni se envían: la cuenta real no se toca.
 */
import { snapshot, ladder, ROWS_FULL, QA_CSEASON, QA_NOW, competitiveBlock } from "../fase28/fixtures";
import type { CompetitiveSnapshot, LadderEntry } from "@/server/services/competitive";
import { rankMovement, type RankMovement } from "@/domain/ranked/standing";
import { deriveRank, rankChip } from "@/domain/ranked/config";

/** Escalera coherente alrededor de un rating propio: 4 puntos por puesto (el rango de cada fila sale de su rating). */
function coherent(rows: LadderEntry[], selfPos: number | null, selfRating: number): LadderEntry[] {
  const anchorPos = selfPos ?? 30, anchor = selfPos ? selfRating : selfRating + 60;
  return rows.map((e) => {
    const rating = e.isSelf ? selfRating : anchor + (anchorPos - e.position) * 4;
    return { ...e, rating, rank: rankChip(deriveRank(rating)) };
  });
}

export { QA_NOW, QA_CSEASON };

const S1 = { placementGames: QA_CSEASON.placementGames, rankConfigVersion: QA_CSEASON.rankConfigVersion };

/** Centro competitivo con el estado de temporada que se pida. `seasonMatches` < 5 → colocación (fuera del Top). */
function hub(o: { rating: number; seasonMatches: number; position: number | null; total?: number; peak?: number | null; rows?: typeof ROWS_FULL; top?: number; pointsToAbove?: number | null; highest?: number | null }): CompetitiveSnapshot {
  const s = snapshot({
    rating: o.rating, gamesPlayed: 20 + o.seasonMatches, wins: 12, losses: 8 + o.seasonMatches, draws: 0, position: o.position, total: o.total ?? 500,
    rows: o.rows ?? ROWS_FULL, top: o.top ?? 10, pointsToAbove: o.pointsToAbove ?? (o.position ? 6 : null), highest: o.highest ?? null, seasonMatches: o.seasonMatches, peakRanked: o.peak ?? null,
  });
  return {
    ...s, leaderboardTop: coherent(s.leaderboardTop, o.position, o.rating), aroundMe: coherent(s.aroundMe, o.position, o.rating),
    competitive: competitiveBlock(o.rating, o.seasonMatches, 6, Math.max(0, o.seasonMatches - 6), 0, o.peak ?? null, o.total ?? 500),
  };
}

export const HUB_UNRANKED = hub({ rating: 1000, seasonMatches: 0, position: null, rows: [], total: 38 });
export const HUB_PLACEMENT_4 = hub({ rating: 1058, seasonMatches: 4, position: null, total: 38, rows: ROWS_FULL.slice(0, 4) });
export const HUB_LOW = hub({ rating: 812, seasonMatches: 11, position: 431, total: 500, peak: 846 });
export const HUB_MID = hub({ rating: 1001, seasonMatches: 9, position: 212, total: 500, peak: 1016 });
export const HUB_HIGH = hub({ rating: 1295, seasonMatches: 26, position: 18, total: 500, peak: 1302 });
export const HUB_CUMBRE = hub({ rating: 1342, seasonMatches: 41, position: 3, total: 500, peak: 1360, highest: 1360, pointsToAbove: 7 });
export const HUB_STALE = { ...hub({ rating: 1105, seasonMatches: 7, position: null, total: 83 }) };
HUB_STALE.competitive = { ...HUB_STALE.competitive, eligibility: { eligible: false, missing: ["Juega una partida (actividad en los últimos 14 días)"] } };
export const HUB_EMPTY_LADDER: CompetitiveSnapshot = { ...hub({ rating: 1000, seasonMatches: 0, position: null, rows: [], total: 0 }), leaderboardTop: [], aroundMe: [] };
HUB_EMPTY_LADDER.self = { ...HUB_EMPTY_LADDER.self, rankedTotal: 0 };

/** Nombre largo (los nombres de BD admiten hasta 40). */
export const HUB_LONG_NAME: CompetitiveSnapshot = (() => {
  const h = hub({ rating: 1188, seasonMatches: 14, position: 4, total: 500 });
  const top = h.leaderboardTop.map((e: LadderEntry, i: number) => (i === 1 ? { ...e, username: "QA_Nombre_De_Jugador_Larguisimo_Extremo" } : e));
  return { ...h, leaderboardTop: top };
})();

/** Alrededor de mí: #124 con los de encima y debajo (el top 10 no me incluye). */
export const HUB_AROUND: CompetitiveSnapshot = (() => {
  const h = hub({ rating: 1201, seasonMatches: 19, position: 124, total: 500 });
  return { ...h, aroundMe: coherent(ladder(127, 124, 1201).slice(120, 127), 124, 1201) };
})();

/* ── resultados (asiento del servidor → movimiento) ── */
const mv = (oldRating: number, newRating: number, n: number, rule = "STANDARD"): RankMovement => rankMovement({ oldRating, newRating, seasonMatchNumber: n, rule }, S1);
export const RESULT_PLACEMENT_1 = mv(1000, 1020, 1);
export const RESULT_PLACEMENT_4 = mv(1040, 1059, 4);
export const RESULT_REVEAL = mv(1059, 1079, 5);
export const RESULT_PROMOTION_DIV = mv(1004, 1018, 11);
export const RESULT_PROMOTION_TIER = mv(1211, 1229, 23);
export const RESULT_PROMOTION_CUMBRE = mv(1301, 1316, 40);
export const RESULT_DEMOTION = mv(953, 939, 14);
export const RESULT_SAME = mv(1001, 1009, 12);
export const RESULT_SAME_LOSS = mv(1009, 997, 13);
export const RESULT_PAIR_CAP = mv(1100, 1100, 16, "PAIR_CAP");

export const EVENT = (m: RankMovement) => ({ matchId: "qa-f84", oldRating: m.oldRating, delta: m.delta, newRating: m.newRating, opponentRating: 1180, kFactor: m.pairCapped ? 0 : 24, result: (m.delta >= 0 ? "WIN" : "LOSS") as "WIN" | "LOSS", createdAt: QA_NOW });
