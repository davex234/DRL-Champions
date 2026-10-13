/**
 * LADDER PvP — DOMINIO PURO (Fase 28).
 *
 * Todo lo que el competitivo necesita LEER del rating real (`duel_pvp_ratings`,
 * `duel_pvp_rating_events`, `duel_matches` PvP) sin tocar la fórmula: orden determinista de la
 * clasificación, posición y percentil, ventana «alrededor de mí», forma reciente, racha, winrate,
 * cara a cara, clasificación de cada partida (victoria/derrota/empate/abandono/tiempo) y puntos
 * de la evolución de rating a partir de los eventos persistidos (old → new, nunca reconstruidos).
 *
 * Sin React, sin red, sin reloj implícito. No hay tiers: el competitivo es rating + ladder porque
 * eso es lo que el backend tiene (`INITIAL_RATING` 1000, K 40/24, provisional < 10 partidas).
 */
import { PLACEMENT_GAMES, isProvisional, INITIAL_RATING } from "@/domain/cardgame/rating";
import type { RatingResult } from "@/domain/cardgame/rating";
import { ns } from "@/i18n/runtime";

const t = ns("pvpLadder");

export { PLACEMENT_GAMES, isProvisional, INITIAL_RATING };

/* ───────────────────────────── orden y posición ───────────────────────────── */

/** Fila mínima de la tabla de ratings que hace falta para ordenar. */
export interface LadderRow {
  userId: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  /** ms UTC de `updated_at`. */
  updatedAt: number;
}

/** Solo quien ha jugado al menos una partida PvP liquidada está en la escalera. */
export const isRanked = (r: Pick<LadderRow, "gamesPlayed">): boolean => r.gamesPlayed >= 1;

/**
 * ORDEN DETERMINISTA DE LA ESCALERA (documentado, no cambia la fórmula):
 *   1. rating descendente;
 *   2. a igual rating, quien lo alcanzó ANTES (`updated_at` ascendente) va delante;
 *   3. a igual instante, `user_id` ascendente.
 * Es el mismo orden que usa la consulta SQL (`order by rating desc, updated_at asc, user_id asc`).
 */
export function compareLadder(a: LadderRow, b: LadderRow): number {
  return b.rating - a.rating || a.updatedAt - b.updatedAt || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
}

export function sortLadder(rows: LadderRow[]): LadderRow[] {
  return rows.filter(isRanked).sort(compareLadder);
}

/** Posición 1-based del jugador en una lista YA ordenada; `null` si no está (nunca #0). */
export function positionOf(sorted: LadderRow[], userId: string): number | null {
  const i = sorted.findIndex((r) => r.userId === userId);
  return i >= 0 ? i + 1 : null;
}

/**
 * Cuántos van por delante de `self` según el orden de la escalera. Es lo que calcula el servidor
 * con tres recuentos acotados (rating mayor · mismo rating y antes · mismo rating, mismo instante,
 * id menor); aquí sirve para probar que ambas lecturas coinciden.
 */
export function rankedAbove(rows: LadderRow[], self: LadderRow): number {
  return rows.filter((r) => r.userId !== self.userId && isRanked(r) && compareLadder(r, self) < 0).length;
}

/** Población mínima para que un percentil signifique algo. Por debajo no se enseña. */
export const PERCENTILE_MIN_POPULATION = 20;

/** «Top N %»: solo con población suficiente y posición conocida. Redondeado hacia arriba, mínimo 1. */
export function percentile(position: number | null, total: number): number | null {
  if (position === null || total < PERCENTILE_MIN_POPULATION || position < 1 || position > total) return null;
  return Math.max(1, Math.ceil((position / total) * 100));
}

/** Índices [from, to) de la ventana «alrededor de mí» (0-based) para una posición 1-based. */
export function aroundWindow(position: number, total: number, before = 3, after = 3): { from: number; to: number } {
  const from = Math.max(0, position - 1 - before);
  const to = Math.min(total, position + after);
  return { from, to };
}

/** Quita de «alrededor» a quien ya está en el top: nadie sale dos veces. */
export function dedupeAround<T extends { userId: string }>(top: T[], around: T[]): T[] {
  const seen = new Set(top.map((r) => r.userId));
  return around.filter((r) => !seen.has(r.userId));
}

/** Límites de las lecturas (servidor y cliente los comparten). */
export const LIMITS = { top: 25, topMax: 50, around: 3, history: 10, historyMax: 20, ratingHistory: 20 } as const;

export const clampLimit = (n: unknown, def: number, max: number): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : def;
  return Math.max(1, Math.min(max, v));
};

/* ───────────────────────────── partidas ───────────────────────────── */

/** Cómo terminó una partida PvP para UN jugador. Nombra lo que pasó, no lo que se supone. */
export type MatchOutcome = "WIN" | "LOSS" | "DRAW" | "ABANDON_WIN" | "ABANDON_LOSS" | "TIMEOUT_WIN" | "TIMEOUT_LOSS" | "UNRESOLVED" | "IN_PROGRESS";

export interface MatchFacts {
  status: string;
  winner: "A" | "B" | null;
  closedReason: "ABANDONED" | "EXPIRED" | null;
  closedBy: string | null;
  playerAId: string;
  playerBId: string;
}

/** Bando del espectador en la partida; `null` si no participa. */
export function sideOf(m: Pick<MatchFacts, "playerAId" | "playerBId">, userId: string): "A" | "B" | null {
  if (m.playerAId === userId) return "A";
  if (m.playerBId === userId) return "B";
  return null;
}

export function outcomeFor(m: MatchFacts, userId: string): MatchOutcome {
  const side = sideOf(m, userId);
  if (!side) return "UNRESOLVED";
  if (m.closedReason === "ABANDONED") return m.closedBy === userId ? "ABANDON_LOSS" : "ABANDON_WIN";
  if (m.closedReason === "EXPIRED") return m.closedBy === userId ? "TIMEOUT_LOSS" : "TIMEOUT_WIN";
  if (m.status === "IN_PROGRESS" || m.status === "WAITING") return "IN_PROGRESS";
  if (m.status === "DRAW") return "DRAW";
  if (m.status === "COMPLETED" && m.winner) return m.winner === side ? "WIN" : "LOSS";
  return "UNRESOLVED";
}

/** W/L/D de un desenlace, o `null` si no cuenta (en curso, sin resolver). */
export function letterOf(o: MatchOutcome): "W" | "L" | "D" | null {
  if (o === "WIN" || o === "ABANDON_WIN" || o === "TIMEOUT_WIN") return "W";
  if (o === "LOSS" || o === "ABANDON_LOSS" || o === "TIMEOUT_LOSS") return "L";
  if (o === "DRAW") return "D";
  return null;
}

export const OUTCOME_LABEL: Record<MatchOutcome, string> = {
  WIN: "Victoria", LOSS: "Derrota", DRAW: "Empate",
  ABANDON_WIN: "Victoria · el rival abandonó", ABANDON_LOSS: "Derrota · abandonaste",
  TIMEOUT_WIN: "Victoria · tiempo del rival agotado", TIMEOUT_LOSS: "Derrota · tiempo agotado",
  UNRESOLVED: "Sin resolver", IN_PROGRESS: "En curso",
};

/** Cuenta como partida jugada para winrate y forma: solo lo terminado con desenlace. */
export const countsForRecord = (o: MatchOutcome): boolean => letterOf(o) !== null;

/* ───────────────────────────── forma, racha, winrate ───────────────────────────── */

/** Últimas N letras, de la más reciente a la más antigua. */
export function recentForm(outcomes: MatchOutcome[], n = 10): ("W" | "L" | "D")[] {
  return outcomes.map(letterOf).filter((l): l is "W" | "L" | "D" => l !== null).slice(0, n);
}

/** Racha actual derivada del historial (más reciente primero). `{kind:"W", n:3}` = 3 victorias seguidas. */
export function streak(form: ("W" | "L" | "D")[]): { kind: "W" | "L" | "D"; n: number } | null {
  if (form.length === 0) return null;
  const kind = form[0];
  let n = 0;
  for (const l of form) { if (l === kind) n++; else break; }
  return { kind, n };
}

/** Winrate = victorias / partidas terminadas con desenlace. `null` sin partidas. */
export function winrate(wins: number, losses: number, draws: number): number | null {
  const total = wins + losses + draws;
  return total > 0 ? Math.round((wins / total) * 100) : null;
}

/** Cara a cara entre dos jugadores, desde la perspectiva de `userId`, sobre partidas ya terminadas. */
export function headToHead(matches: MatchFacts[], userId: string, rivalId: string): { wins: number; losses: number; draws: number } {
  const out = { wins: 0, losses: 0, draws: 0 };
  for (const m of matches) {
    const s = sideOf(m, userId);
    const r = sideOf(m, rivalId);
    if (!s || !r || s === r) continue;
    const l = letterOf(outcomeFor(m, userId));
    if (l === "W") out.wins++; else if (l === "L") out.losses++; else if (l === "D") out.draws++;
  }
  return out;
}

/* ───────────────────────────── evolución de rating ───────────────────────────── */

export interface RatingPoint { matchId: string; at: number; rating: number; delta: number; result: RatingResult }

/**
 * Puntos del gráfico a partir de los EVENTOS persistidos (old/delta/new por partida), del más
 * antiguo al más reciente. Nada se reconstruye: cada punto es `new_rating` de un asiento.
 */
export function ratingSeries(events: { matchId: string; createdAt: number; newRating: number; delta: number; result: RatingResult }[]): RatingPoint[] {
  return [...events]
    .sort((a, b) => a.createdAt - b.createdAt || a.matchId.localeCompare(b.matchId))
    .map((e) => ({ matchId: e.matchId, at: e.createdAt, rating: e.newRating, delta: e.delta, result: e.result }));
}

/** Rating máximo alcanzado: el mayor `new_rating` de todo el libro, o el inicial si nunca hubo asiento. */
export function highestRating(allNewRatings: number[], initial = INITIAL_RATING): number | null {
  if (allNewRatings.length === 0) return null;
  return Math.max(initial, ...allNewRatings);
}

/** Resumen textual del gráfico (accesibilidad). */
export function seriesSummary(points: RatingPoint[]): string {
  if (points.length === 0) return t("Sin partidas liquidadas todavía.");
  const first = points[0].rating - points[0].delta;
  const last = points[points.length - 1].rating;
  const min = Math.min(...points.map((p) => p.rating));
  const max = Math.max(...points.map((p) => p.rating));
  const diff = last - first;
  return t("{length} {v}: de {first} a {last} ({v2}{diff}), mínimo {min}, máximo {max}.", { length: points.length, v: points.length === 1 ? t("partida") : t("partidas"), first, last, v2: diff >= 0 ? "+" : "", diff, min, max });
}

/* ───────────────────────────── cartas ───────────────────────────── */

export interface PlayedCardFact { uid: string; cardId: string; nick: string; won: boolean }

export interface CardPerformance { cardId: string; nick: string; played: number; turnsWon: number }

/** Estadística PERSONAL de cartas sobre las partidas del propio jugador: usos y turnos ganados. */
export function cardPerformance(facts: PlayedCardFact[]): { mostUsed: CardPerformance | null; mostWinning: CardPerformance | null; all: CardPerformance[] } {
  const by = new Map<string, CardPerformance>();
  for (const f of facts) {
    const c = by.get(f.cardId) ?? { cardId: f.cardId, nick: f.nick, played: 0, turnsWon: 0 };
    c.played++; if (f.won) c.turnsWon++;
    by.set(f.cardId, c);
  }
  const all = [...by.values()];
  const mostUsed = [...all].sort((a, b) => b.played - a.played || b.turnsWon - a.turnsWon || a.cardId.localeCompare(b.cardId))[0] ?? null;
  const mostWinning = [...all].filter((c) => c.turnsWon > 0).sort((a, b) => b.turnsWon - a.turnsWon || b.played - a.played || a.cardId.localeCompare(b.cardId))[0] ?? null;
  return { mostUsed, mostWinning, all };
}

/* ───────────────────────────── post-partida ───────────────────────────── */

/** Cambio de posición SOLO si se conocen las dos fotos (antes y después del asiento). */
export function positionDelta(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  return before - after; // positivo = has subido puestos
}

export function positionChangeLabel(before: number | null, after: number | null): string | null {
  const d = positionDelta(before, after);
  if (d === null) return null;
  if (d > 0) return d === 1 ? t("Subes {n} puesto", { n: d }) : t("Subes {n} puestos", { n: d });
  if (d < 0) return d === -1 ? t("Bajas {n} puesto", { n: -d }) : t("Bajas {n} puestos", { n: -d });
  return t("Mantienes tu puesto");
}

/** Frase de la home: solo lo derivable. Nunca promete una posición tras una victoria. */
export function competitiveHint(input: { position: number | null; total: number; provisional: boolean; gamesPlayed: number; pointsToAbove: number | null }): string | null {
  if (input.gamesPlayed === 0) return null;
  if (input.provisional) return t("Provisional: {gamesPlayed} de {PLACEMENT_GAMES} partidas para clasificarte", { gamesPlayed: input.gamesPlayed, PLACEMENT_GAMES });
  if (input.position === null) return null;
  if (input.pointsToAbove !== null && input.pointsToAbove > 0) return t("Estás #{position} · te faltan {pointsToAbove} puntos para pasar al siguiente", { position: input.position, pointsToAbove: input.pointsToAbove });
  return t("Estás #{position} de {total}", { position: input.position, total: input.total });
}
