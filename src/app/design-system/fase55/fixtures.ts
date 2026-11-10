/**
 * FIXTURES QA SYNTHETIC · FASE 55 — solo para el arnés `/design-system/fase55` y sus capturas.
 *
 * Misma forma que `GET /api/game/competitive` (+ `?ladder=` y `?matchup=`); jugadores, ratings, temporada y partidas
 * INVENTADOS y etiquetados, construidos con los helpers del arnés de la Fase 28. Nunca se escriben ni se envían, y la
 * cuenta real no se toca: los estados (bloqueado, ascenso, descenso…) se ven aquí, no forzando datos reales.
 */
import { SEASON_CALENDAR } from "@/data/seasonCalendar";
import { resolveCalendar } from "@/domain/season/calendar";
import { seasonRecord, rankedMovement, type ReadinessDeck } from "@/domain/pvpLadder/ranked";
import type { CompetitiveSnapshot, CompetitiveSeason, CompetitiveLadderPage, CompetitiveMatchup, LadderEntry } from "@/server/services/competitive";
import { deriveRank, rankChip } from "@/domain/ranked/config";
import { snapshot, matches, ladder, ROWS_FULL, QA_NOW, ME, RIVAL } from "../fase28/fixtures";

export { QA_NOW, ROWS_FULL };

const H = 3600_000;

/** Temporada activa del calendario REAL a la hora QA, con un récord sintético leído como el libro. */
export function season(record: { wins: number; losses: number; draws: number; start: number }): CompetitiveSeason | null {
  const cal = resolveCalendar(SEASON_CALENDAR, QA_NOW);
  if (!cal.ok || !cal.current) return null;
  const s = cal.current;
  const evs: { createdAt: number; result: "WIN" | "LOSS" | "DRAW"; oldRating: number; newRating: number; delta: number }[] = [];
  let r = record.start;
  const push = (result: "WIN" | "LOSS" | "DRAW", delta: number, i: number) => { evs.push({ createdAt: s.startsAtMs + (i + 1) * 6 * H, result, oldRating: r, newRating: r + delta, delta }); r += delta; };
  let i = 0;
  for (let k = 0; k < record.wins; k++) push("WIN", 16 + (k % 4), i++);
  for (let k = 0; k < record.losses; k++) push("LOSS", -(12 + (k % 3)), i++);
  for (let k = 0; k < record.draws; k++) push("DRAW", 0, i++);
  return {
    id: s.id, name: s.name, displayName: s.displayName, startsAt: s.startsAtMs, endsAt: s.endsAtMs,
    remainingMs: s.remainingMs, presentation: s.presentation, resetsRating: false,
    record: seasonRecord(evs, { startsAtMs: s.startsAtMs, endsAtMs: s.endsAtMs }),
  };
}

const withSeason = (snap: CompetitiveSnapshot, s: CompetitiveSeason | null): CompetitiveSnapshot => ({ ...snap, season: s });

/** Clasificado a mitad de escalera: #124 de 500, 27 partidas, carril del pase cerrado (214 / 400). */
export const HUB = withSeason(
  snapshot({ rating: 1201, gamesPlayed: 27, wins: 15, losses: 10, draws: 2, position: 124, total: 500, rows: ROWS_FULL, pointsToAbove: 9, highest: 1233 }),
  season({ wins: 8, losses: 5, draws: 1, start: 1150 }),
);
/** Jugador nuevo sin partidas ranked: sin clasificar, carril del pase cerrado 78 / 400 (la cifra de la demo). */
export const NEW = withSeason(
  { ...snapshot({ rating: 1000, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, position: null, total: 38, rows: [], top: 10 }), rewards: { ...snapshot({ rating: 1000, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, position: null, total: 38, rows: [] }).rewards, points: 78 } },
  season({ wins: 0, losses: 0, draws: 0, start: 1000 }),
);
/** En colocación: 4 / 5 de la temporada competitiva (F84; antes 4 / 10 de por vida). Fuera del Top hasta cerrarla. */
export const PLACEMENT = withSeason(
  snapshot({ rating: 1058, gamesPlayed: 4, wins: 3, losses: 1, draws: 0, position: null, total: 38, rows: ROWS_FULL.slice(0, 4), top: 10 }),
  season({ wins: 3, losses: 1, draws: 0, start: 1000 }),
);
/** Número 1 con el carril competitivo abierto. */
export const FIRST = withSeason(
  snapshot({ rating: 1488, gamesPlayed: 61, wins: 40, losses: 19, draws: 2, position: 1, total: 500, rows: ROWS_FULL, highest: 1502, unlockedRewards: true, passLevel: 14 }),
  season({ wins: 19, losses: 6, draws: 1, start: 1390 }),
);

/* ───────────────────────────── mazos (forma de `/api/game/duels`) ───────────────────────────── */

export const DECK_OK: ReadinessDeck = { id: "00000000-0000-4000-8000-00000000d001", name: "QA · Ofensiva EMEA", valid: true, errors: [], cards: Array.from({ length: 10 }) };
export const DECK_OK_2: ReadinessDeck = { id: "00000000-0000-4000-8000-00000000d002", name: "QA · Control Pacífico", valid: true, errors: [], cards: Array.from({ length: 10 }) };
export const DECK_BAD: ReadinessDeck = {
  id: "00000000-0000-4000-8000-00000000d003", name: "QA · Mazo a medias", valid: false, cards: Array.from({ length: 8 }),
  // Frases EXACTAS del validador canónico (`explainDeckError`), como las manda el servidor.
  errors: [{ message: "El mazo debe tener 10 cartas: te faltan 2." }, { message: "Necesitas 2 cartas de Centinela; ahora tienes 1." }],
};

/* ───────────────────────────── clasificación paginada ───────────────────────────── */

const LADDER_500 = ladder(500, 124, 1201);
export function ladderPage(offset: number): CompetitiveLadderPage {
  const size = 25;
  const o = Math.max(0, Math.min(475, Math.floor(offset / size) * size));
  return { offset: o, size, total: 500, hasPrev: o > 0, hasNext: o + size < 500, entries: LADDER_500.slice(o, o + size) as LadderEntry[], selfPosition: 124, selfPageOffset: 100 };
}

/* ───────────────────────────── rival encontrado ───────────────────────────── */

export const MATCHUP: CompetitiveMatchup = {
  matchId: "00000000-0000-4000-8000-0000000000a1",
  you: { ...ME, username: "QA · tú", rating: 1201, gamesPlayed: 27, provisional: false, position: 124, rankLabel: deriveRank(1201).label, rank: rankChip(deriveRank(1201)) },
  rival: { ...RIVAL, rating: 1236, gamesPlayed: 33, provisional: false, position: 98, rankLabel: deriveRank(1236).label, rank: rankChip(deriveRank(1236)) },
  rivalKind: "HUMAN", rankedTotal: 500,
};

/* ───────────────────────────── movimientos post-partida ───────────────────────────── */

export const MOVE_HOLD = rankedMovement({ rating: 1201, position: 124, gamesPlayed: 27 }, { rating: 1219, position: 124, gamesPlayed: 28 });
export const MOVE_UP = rankedMovement({ rating: 1201, position: 14, gamesPlayed: 27 }, { rating: 1219, position: 9, gamesPlayed: 28 });
export const MOVE_DOWN = rankedMovement({ rating: 1201, position: 124, gamesPlayed: 27 }, { rating: 1187, position: 131, gamesPlayed: 28 });
export const MOVE_PLACED = rankedMovement({ rating: 1071, position: 22, gamesPlayed: 9 }, { rating: 1093, position: 17, gamesPlayed: 10 });
export const MOVE_ENTERED = rankedMovement({ rating: 1000, position: null, gamesPlayed: 0 }, { rating: 1020, position: 30, gamesPlayed: 1 });

export const HISTORY = matches([
  { outcome: "WIN", delta: 18, score: [6, 4] }, { outcome: "LOSS", delta: -14, score: [3, 6] }, { outcome: "WIN", delta: 16, score: [7, 3] },
  { outcome: "TIMEOUT_WIN", delta: 15, score: [4, 2] }, { outcome: "DRAW", delta: 0, score: [5, 5] }, { outcome: "ABANDON_LOSS", delta: -13, score: [1, 3] },
  { outcome: "WIN", delta: 17, score: [6, 5] }, { outcome: "LOSS", delta: -11, score: [4, 6] },
], 1140).map((m, i) => ({ ...m, at: QA_NOW - (i + 1) * 3 * H }));
