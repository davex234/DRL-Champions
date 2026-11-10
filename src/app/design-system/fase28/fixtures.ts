/**
 * FIXTURES QA SYNTHETIC · FASE 28 — solo para el arnés `/design-system/fase28` y sus capturas.
 * Misma forma que `GET /api/game/competitive`; jugadores, ratings y partidas INVENTADOS y etiquetados.
 * Nunca se escriben ni se envían. Los desenlaces/estados usan el vocabulario real del dominio.
 */
import { CURRENT_SEASON } from "@/data/season";
import { trackOf } from "@/battlepass";
import { ratingSeries, recentForm, streak, winrate, type MatchOutcome, type RatingPoint } from "@/domain/pvpLadder/ladder";
import type {
  CompetitiveSnapshot, LadderEntry, CompetitiveMatchRow, CompetitivePlayerView, CompetitiveMatchDetail, CompetitiveStats, CompetitiveSelf, PublicPlayer,
} from "@/server/services/competitive";
// F84 · las filas y el bloque competitivo llevan rango derivado del rating (mismas funciones que el servidor).
import { deriveRank, rankChip } from "@/domain/ranked/config";
import { competitiveStanding, topEligibility, SEASON_1_DEFAULTS, type CompetitiveSeasonInfo } from "@/domain/ranked/standing";
import type { DuelMatchView, DuelTurnView } from "@/lib/duel/types";

export const QA_NOW = Date.UTC(2026, 8, 14, 15, 30);
const H = 3600_000;

const NAMES = ["Vortex", "Kaelis", "Nyra", "Brann", "Sable", "Orion", "Lume", "Tarek", "Ivy", "Rook", "Zephyr", "Mira", "Dax", "Sol", "Kira", "Pax", "Wren", "Juno", "Ash", "Ren", "Nox", "Elm", "Bex", "Cy", "Odo"];
const AV = ["🦊", "🐉", "🦉", "🐺", "🦅", "🐙", "🦁", "🐍", "🦋", "🐻"];

export const ME: PublicPlayer = { userId: "00000000-0000-4000-8000-0000000000aa", username: "QA · tú", avatar: "🎮" };

/** F84 · temporada competitiva sintética del arnés (forma de `competitive_seasons`). */
export const QA_CSEASON: CompetitiveSeasonInfo = {
  id: "competitiva-1", number: 1, name: "Temporada competitiva 1", startsAt: Date.UTC(2026, 9, 4, 16), endsAt: null,
  rankConfigVersion: "rank-v1", formulaVersion: "ranked-rating-v1", placementGames: SEASON_1_DEFAULTS.placementGames,
  top: { ...SEASON_1_DEFAULTS.top }, pairCap: { ...SEASON_1_DEFAULTS.pairCap }, gameSeasonId: null,
};
export const RIVAL: PublicPlayer = { userId: "00000000-0000-4000-8000-0000000000bb", username: "Kaelis", avatar: "🐉" };

export function ladder(n: number, selfPosition: number | null, selfRating: number, sameRatingAt: number | null = null): LadderEntry[] {
  const out: LadderEntry[] = [];
  for (let i = 1; i <= n; i++) {
    const isSelf = selfPosition === i;
    // Escalera coherente: desciende 2,4 puntos por puesto (el #124 queda ≈ 1202, junto al self de 1201).
    const rating = isSelf ? selfRating : Math.max(900, Math.round(1500 - i * 2.4));
    out.push({
      userId: isSelf ? ME.userId : `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      username: isSelf ? ME.username : NAMES[(i - 1) % NAMES.length], avatar: isSelf ? ME.avatar : AV[i % AV.length],
      position: i, rating: sameRatingAt !== null && (i === sameRatingAt || i === sameRatingAt + 1) ? 1187 : rating,
      gamesPlayed: 12 + i, wins: 6 + Math.floor(i / 2), losses: 5 + Math.floor(i / 3), draws: i % 2, provisional: false, isSelf,
      rank: rankChip(deriveRank(sameRatingAt !== null && (i === sameRatingAt || i === sameRatingAt + 1) ? 1187 : rating)),
      season: { matches: 9 + (i % 7), wins: 5 + (i % 4), losses: 4 + (i % 7) - (i % 4), draws: 0, lastMatchAt: QA_NOW - (i % 5) * H },
    });
  }
  return out;
}

const player = (i: number): PublicPlayer => ({ userId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, username: NAMES[i % NAMES.length], avatar: AV[i % AV.length] });

export function matches(spec: { outcome: MatchOutcome; delta: number | null; score: [number, number] }[], startRating = 1200): CompetitiveMatchRow[] {
  let r = startRating;
  return spec.map((s, i) => {
    const before = r; const after = s.delta === null ? r : r + s.delta; r = after;
    const letter = s.outcome === "WIN" || s.outcome === "ABANDON_WIN" || s.outcome === "TIMEOUT_WIN" ? "W" : s.outcome === "DRAW" ? "D" : s.outcome === "IN_PROGRESS" || s.outcome === "UNRESOLVED" ? null : "L";
    return {
      matchId: `00000000-0000-4000-8000-00000000f${String(i).padStart(3, "0")}`, at: QA_NOW - (i + 1) * 5 * H, outcome: s.outcome, letter,
      scoreYou: s.score[0], scoreRival: s.score[1], rival: i === 1 || i === 4 ? RIVAL : player(i + 3),
      rating: s.delta === null ? null : { before, delta: s.delta, after }, turns: 10,
      lifecycle: s.outcome.startsWith("ABANDON") ? "ABANDONED" : s.outcome.startsWith("TIMEOUT") ? "EXPIRED" : s.outcome === "IN_PROGRESS" ? "IN_TURN" : "FINISHED",
    };
  });
}

/** Serie de rating a partir de las partidas (asientos reales en producción; aquí sintéticos). */
export function series(rows: CompetitiveMatchRow[]): RatingPoint[] {
  return ratingSeries(rows.filter((m) => m.rating).map((m) => ({
    matchId: m.matchId, createdAt: m.at, newRating: m.rating!.after, delta: m.rating!.delta,
    result: m.letter === "W" ? "WIN" : m.letter === "L" ? "LOSS" : "DRAW",
  })));
}

function stats(rows: CompetitiveMatchRow[], wins: number, losses: number, draws: number): CompetitiveStats {
  const form = recentForm(rows.map((m) => m.outcome), 10);
  return { matches: wins + losses + draws, wins, losses, draws, winrate: winrate(wins, losses, draws), form, streak: streak(form) };
}

export function snapshot(o: {
  rating: number; gamesPlayed: number; wins: number; losses: number; draws: number; position: number | null; total: number;
  rows: CompetitiveMatchRow[]; top?: number; pointsToAbove?: number | null; highest?: number | null; unlockedRewards?: boolean; passLevel?: number; sameRatingAt?: number | null;
  /** F84 · partidas de la temporada competitiva (colocación = 5) y mejor rating desde la colocación. */
  seasonMatches?: number; peakRanked?: number | null;
}): CompetitiveSnapshot {
  const top = ladder(o.top ?? 10, o.position !== null && o.position <= (o.top ?? 10) ? o.position : null, o.rating, o.sameRatingAt ?? null);
  const aroundMe = o.position !== null && o.position > (o.top ?? 10)
    ? ladder(o.position + 3, o.position, o.rating).slice(o.position - 4, o.position + 3)
    : [];
  const provisional = o.gamesPlayed < 10;
  const self: CompetitiveSelf = {
    rating: { rating: o.rating, gamesPlayed: o.gamesPlayed, wins: o.wins, losses: o.losses, draws: o.draws, provisional, updatedAt: QA_NOW - H },
    position: o.position, rankedTotal: o.total, percentile: o.position !== null && o.total >= 20 ? Math.max(1, Math.ceil((o.position / o.total) * 100)) : null,
    pointsToAbove: o.pointsToAbove ?? null, highestRating: o.highest ?? null, placementGames: 10,
  };
  const comp = trackOf(CURRENT_SEASON, "competitive");
  const passLevel = o.passLevel ?? 12;
  return {
    serverNow: QA_NOW, self, stats: stats(o.rows, o.wins, o.losses, o.draws),
    leaderboardTop: top, aroundMe, recentMatches: o.rows.slice(0, 10), nextBefore: o.rows.length > 10 ? o.rows[9].at : null,
    ratingSeries: series([...o.rows].reverse()),
    cards: o.rows.length > 0 ? { mostUsed: { cardId: "aspas", nick: "aspas", played: 14, turnsWon: 9 }, mostWinning: { cardId: "trent", nick: "trent", played: 10, turnsWon: 8 }, sample: Math.min(10, o.rows.length) } : { mostUsed: null, mostWinning: null, sample: 0 },
    rewards: {
      unlocked: o.unlockedRewards ?? false, minPoints: CURRENT_SEASON.competitiveMinPoints ?? 0, points: o.unlockedRewards ? 420 : 214, passLevel,
      levels: Object.keys(comp).map(Number).sort((a, b) => a - b).map((l) => ({ level: l, reward: comp[l], claimed: (o.unlockedRewards ?? false) && l <= 5, claimable: (o.unlockedRewards ?? false) && l <= passLevel && l > 5 })),
    },
    season: null, // Fase 55: la temporada del competitivo se prueba en el arnés fase55.
    competitive: competitiveBlock(o.rating, o.seasonMatches ?? Math.min(o.gamesPlayed, 12), o.wins, o.losses, o.draws, o.peakRanked ?? o.highest ?? null, o.total),
  };
}

/** F84 · bloque competitivo sintético con las MISMAS funciones puras que usa el servidor. */
export function competitiveBlock(rating: number, seasonMatches: number, wins: number, losses: number, draws: number, peakRanked: number | null, eligible: number): CompetitiveSnapshot["competitive"] {
  const m = Math.max(0, seasonMatches);
  const scale = (n: number) => (wins + losses + draws > 0 ? Math.round((n / (wins + losses + draws)) * m) : 0);
  const w = scale(wins), d = scale(draws), l = Math.max(0, m - w - d);
  const record = m > 0 ? {
    matches: m, wins: w, losses: l, draws: d, seedRating: rating, placementCompletedAt: m >= 5 ? QA_NOW - 24 * H : null,
    peakRating: Math.max(rating, peakRanked ?? rating), peakRankedRating: m >= 5 ? Math.max(rating, peakRanked ?? rating) : null, lastMatchAt: QA_NOW - 2 * H,
  } : null;
  const standing = competitiveStanding({ rating, season: QA_CSEASON, record });
  return { season: QA_CSEASON, standing, eligibility: topEligibility(standing, record?.lastMatchAt ?? null, QA_CSEASON.top, QA_NOW), lastMatchAt: record?.lastMatchAt ?? null, eligibleTotal: eligible };
}

/* ───────────────────────────── perfiles QA ───────────────────────────── */

export const ROWS_FULL = matches([
  { outcome: "WIN", delta: 18, score: [6, 4] }, { outcome: "LOSS", delta: -12, score: [3, 6] }, { outcome: "WIN", delta: 16, score: [7, 3] },
  { outcome: "WIN", delta: 14, score: [5, 4] }, { outcome: "TIMEOUT_WIN", delta: 15, score: [4, 2] }, { outcome: "DRAW", delta: 0, score: [5, 5] },
  { outcome: "ABANDON_LOSS", delta: -13, score: [1, 3] }, { outcome: "LOSS", delta: -11, score: [4, 6] }, { outcome: "WIN", delta: 17, score: [6, 5] },
  { outcome: "WIN", delta: 12, score: [6, 3] }, { outcome: "LOSS", delta: -14, score: [2, 6] }, { outcome: "WIN", delta: 19, score: [6, 4] },
], 1140);

export const RANKED = snapshot({ rating: 1201, gamesPlayed: 27, wins: 15, losses: 10, draws: 2, position: 124, total: 500, rows: ROWS_FULL, pointsToAbove: 9, highest: 1233 });
export const TOP10 = snapshot({ rating: 1420, gamesPlayed: 61, wins: 40, losses: 19, draws: 2, position: 4, total: 500, rows: ROWS_FULL, pointsToAbove: 3, highest: 1440, unlockedRewards: true, passLevel: 14 });
export const PROVISIONAL = snapshot({ rating: 1058, gamesPlayed: 4, wins: 3, losses: 1, draws: 0, position: 210, total: 500, rows: ROWS_FULL.slice(0, 4), pointsToAbove: 2 });
export const NEW_PLAYER = snapshot({ rating: 1000, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, position: null, total: 500, rows: [] });
export const SMALL_POP = snapshot({ rating: 1024, gamesPlayed: 6, wins: 4, losses: 2, draws: 0, position: 2, total: 3, rows: ROWS_FULL.slice(0, 6), top: 3 });
export const SAME_RATING = snapshot({ rating: 1187, gamesPlayed: 20, wins: 10, losses: 9, draws: 1, position: 6, total: 500, rows: ROWS_FULL, sameRatingAt: 5, pointsToAbove: 1 });
export const SOLO = snapshot({ rating: 1016, gamesPlayed: 1, wins: 1, losses: 0, draws: 0, position: 1, total: 1, rows: ROWS_FULL.slice(0, 1), top: 1 });

export const PLAYER_VIEW: CompetitivePlayerView = {
  player: RIVAL, rating: { rating: 1246, gamesPlayed: 33, wins: 20, losses: 12, draws: 1, provisional: false, updatedAt: QA_NOW - 2 * H },
  position: 98, rankedTotal: 500,
  competitive: { season: QA_CSEASON, standing: competitiveBlock(1246, 14, 20, 12, 1, 1262, 500).standing },
  stats: stats(ROWS_FULL.slice(0, 8), 20, 12, 1),
  recentMatches: ROWS_FULL.slice(0, 6).map(({ matchId, at, outcome, letter, scoreYou, scoreRival, rival }) => ({ matchId, at, outcome, letter, scoreYou, scoreRival, rival })),
  h2h: { wins: 2, losses: 1, draws: 0, matches: 3 },
};

/** Detalle de partida: se construye sobre una vista real del motor pasada por el arnés (ver page). */
export function detailFrom(view: DuelMatchView, outcome: MatchOutcome, delta: number): CompetitiveMatchDetail {
  return {
    matchId: ROWS_FULL[0].matchId, at: QA_NOW - 5 * H, closedAt: QA_NOW - 4.8 * H, outcome,
    lifecycle: outcome.startsWith("ABANDON") ? "ABANDONED" : outcome.startsWith("TIMEOUT") ? "EXPIRED" : "FINISHED",
    rival: RIVAL, view: { ...view, rivalLabel: RIVAL.username },
    rating: { matchId: ROWS_FULL[0].matchId, oldRating: 1183, delta, newRating: 1183 + delta, opponentRating: 1246, kFactor: 24, result: delta > 0 ? "WIN" : delta < 0 ? "LOSS" : "DRAW", createdAt: QA_NOW - 4.8 * H },
  };
}

export type { DuelTurnView };
