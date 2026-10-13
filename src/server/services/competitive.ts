/**
 * COMPETITIVO / RANKED 2.0 — MODELO DE LECTURA (Fase 28, SOLO SERVIDOR).
 *
 * Todo lo que el Competitive Hub, el historial, el detalle de partida y el perfil de rival
 * necesitan, leído de las tablas REALES del PvP: `duel_pvp_ratings` (rating, partidas, W/L/D,
 * `updated_at`), `duel_pvp_rating_events` (old → delta → new por partida, el libro que explica
 * cada rating), `duel_matches` con `mode = 'PVP'` (partidas, estado, cierre) y `profiles`
 * (SOLO `username` y `avatar`).
 *
 * **No es autoridad de nada.** No escribe rating, no liquida, no recalcula la fórmula: la
 * posición es un recuento sobre el rating persistido con el orden documentado en
 * `domain/pvpLadder` (rating desc → updated_at asc → user_id asc), y cada delta es el asiento que
 * escribió `duel_pvp_settle_match`. Consultas ACOTADAS (top ≤ 50, alrededor 7, historial ≤ 20).
 *
 * PRIVACIDAD: de otro jugador solo salen nombre, avatar, rating/partidas/W-L-D (públicos en la
 * escalera), su forma reciente y el cara a cara. Nunca su mazo, ni sus cartas no jugadas, ni
 * correo, ni XP/créditos. El detalle de partida es solo de sus dos participantes (404 al resto) y
 * se proyecta con `projectMatchFor`: lo no jugado del rival no viaja aunque la partida acabara.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DuelMatch } from "@/domain/cardgame/match";
import { projectMatchFor } from "@/domain/cardgame/pvp";
import { visualHintValue } from "@/lib/duel/hintVisuals";
import { INITIAL_RATING, isProvisional, type DuelRating, type RatingEvent } from "@/domain/cardgame/rating";
import { serverCatalog, serverCatalogSync } from "@/server/catalog";
import { buildMatchView } from "@/lib/duel/matchView";
import type { DuelMatchView } from "@/lib/duel/types";
import { getRatingHistory } from "./duelsRating";
import { isMissingRelation } from "./f73Config";
import { peekProgression, type PassTrackLevelView } from "./progression";
// Fase 55 · la temporada se lee por la MISMA puerta que `/temporada` (contrato «una sola fuente»).
import { loadSeasonCalendar } from "./season";
import {
  LIMITS, clampLimit, isRanked, percentile, aroundWindow, dedupeAround, outcomeFor, letterOf, recentForm, streak,
  winrate, headToHead, ratingSeries, highestRating, cardPerformance, sideOf,
  type MatchOutcome, type MatchFacts, type RatingPoint, type CardPerformance,
} from "@/domain/pvpLadder/ladder";
import { seasonRecord, ladderPage, type SeasonRecord } from "@/domain/pvpLadder/ranked";
import { resolveCalendar, type SeasonPresentation } from "@/domain/season/calendar";
// F84 · Ranked 2.0: rango derivado del rating (versión de la temporada), colocación y elegibilidad Top.
import { deriveRank, rankChip, type RankChip } from "@/domain/ranked/config";
import {
  competitiveStanding, topEligibility, standingLabel,
  type CompetitiveSeasonInfo, type CompetitiveStanding, type SeasonRecordRow, type TopEligibility,
} from "@/domain/ranked/standing";

export interface CompetitiveResult<T> { ok: boolean; status: number; error?: string; code?: string; data?: T }
const fail = (status: number, error: string, code?: string): CompetitiveResult<never> => ({ ok: false, status, error, code });
const done = <T>(data: T): CompetitiveResult<T> => ({ ok: true, status: 200, data });

/* ───────────────────────────── tipos públicos ───────────────────────────── */

export interface PublicPlayer { userId: string; username: string; avatar: string }

/** F84 · rango visible de una fila (derivado en el servidor del rating canónico, `domain/ranked`). Nunca se guarda. */
export type { RankChip };

export interface LadderEntry extends PublicPlayer {
  position: number;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  provisional: boolean;
  isSelf: boolean;
  /** F84 · rango derivado (la clasificación solo tiene jugadores con la colocación completa). */
  rank: RankChip;
  /** F84 · récord de la TEMPORADA competitiva (no de por vida). */
  season: { matches: number; wins: number; losses: number; draws: number; lastMatchAt: number };
}

/**
 * F84 · BLOQUE COMPETITIVO de la temporada activa: colocación, rango, mejor rango, récord de temporada y por qué estás
 * (o no) en la clasificación Top. Todo del servidor: el cliente no recalcula nada.
 */
export interface CompetitiveBlock {
  season: CompetitiveSeasonInfo | null;
  standing: CompetitiveStanding;
  eligibility: TopEligibility | null;
  lastMatchAt: number | null;
  /** Elegibles en la clasificación (antes del tope). El Top enseña como mucho `season.top.size`. */
  eligibleTotal: number;
}

export interface CompetitiveSelf {
  rating: DuelRating;
  /** Posición 1-based en la escalera; `null` si no ha jugado ninguna partida (nunca 0). */
  position: number | null;
  /** F84 · jugadores en la clasificación de la temporada (elegibles, como mucho el tamaño del Top). */
  rankedTotal: number;
  /** «Top N %» solo con población suficiente. */
  percentile: number | null;
  /** Puntos que le faltan para superar al jugador inmediatamente por delante, o `null`. */
  pointsToAbove: number | null;
  highestRating: number | null;
  placementGames: number;
}

export interface CompetitiveMatchRow {
  matchId: string;
  at: number;
  outcome: MatchOutcome;
  letter: "W" | "L" | "D" | null;
  scoreYou: number;
  scoreRival: number;
  rival: PublicPlayer;
  /** Asiento de rating de ESTA partida para el espectador, si ya se liquidó. */
  rating: { before: number; delta: number; after: number } | null;
  turns: number;
  lifecycle: "FINISHED" | "ABANDONED" | "EXPIRED" | "IN_TURN" | "CREATED";
}

export interface CompetitiveStats {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winrate: number | null;
  form: ("W" | "L" | "D")[];
  streak: { kind: "W" | "L" | "D"; n: number } | null;
}

export interface CompetitiveRewards {
  unlocked: boolean;
  minPoints: number;
  points: number;
  levels: PassTrackLevelView[];
  passLevel: number;
}

export interface CompetitiveSnapshot {
  serverNow: number;
  self: CompetitiveSelf;
  stats: CompetitiveStats;
  leaderboardTop: LadderEntry[];
  aroundMe: LadderEntry[];
  recentMatches: CompetitiveMatchRow[];
  /** Cursor para el historial: `updated_at` (ms) de la última fila devuelta, o `null` si no hay más. */
  nextBefore: number | null;
  ratingSeries: RatingPoint[];
  cards: { mostUsed: CardPerformance | null; mostWinning: CardPerformance | null; sample: number };
  rewards: CompetitiveRewards;
  /**
   * FASE 55 · la temporada ACTIVA del calendario canónico (`SEASON_CALENDAR`, el mismo que lee `/temporada`)
   * y el tramo del rating dentro de su ventana, leído del libro (`duel_pvp_rating_events`). El rating NO se
   * reinicia por temporada: no hay cierre implementado, y `resetsRating: false` lo dice. `null` fuera de temporada.
   */
  season: CompetitiveSeason | null;
  /** F84 · temporada competitiva, colocación, rango y elegibilidad. */
  competitive: CompetitiveBlock;
}

export interface CompetitiveSeason {
  id: string;
  name: string;
  displayName: string;
  startsAt: number;
  endsAt: number;
  remainingMs: number;
  presentation: SeasonPresentation;
  record: SeasonRecord;
  resetsRating: false;
}

/** FASE 55 · una página de la escalera (acotada) para la clasificación paginada. */
export interface CompetitiveLadderPage {
  offset: number;
  size: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  entries: LadderEntry[];
  /** Tu posición y el offset de la página donde estás, para «ir a mi posición». */
  selfPosition: number | null;
  selfPageOffset: number | null;
}

/** FASE 55 · «RIVAL ENCONTRADO»: los dos lados de UNA partida ranked, solo para sus dos jugadores. */
export interface CompetitiveMatchupSide extends PublicPlayer {
  rating: number;
  gamesPlayed: number;
  provisional: boolean;
  position: number | null;
  /** F84 · «Titular II» / «Colocación 3/5» / «Sin clasificar» (de la temporada activa). */
  rankLabel: string;
  rank: RankChip | null;
}
export interface CompetitiveMatchup {
  matchId: string;
  you: CompetitiveMatchupSide;
  rival: CompetitiveMatchupSide;
  /** La cola ranked solo empareja personas (`duel_pvp_claim_pair`): nunca un bot. */
  rivalKind: "HUMAN";
  rankedTotal: number;
}

export interface CompetitivePlayerView {
  player: PublicPlayer;
  rating: DuelRating | null;
  position: number | null;
  rankedTotal: number;
  /** F84 · estado competitivo PÚBLICO en la temporada activa (rango solo si completó la colocación). */
  competitive: { season: Pick<CompetitiveSeasonInfo, "id" | "name" | "number" | "placementGames" | "rankConfigVersion"> | null; standing: CompetitiveStanding };
  stats: CompetitiveStats;
  recentMatches: Pick<CompetitiveMatchRow, "matchId" | "at" | "outcome" | "letter" | "scoreYou" | "scoreRival" | "rival">[];
  /** Cara a cara desde la perspectiva del ESPECTADOR. `null` si son la misma persona. */
  h2h: { wins: number; losses: number; draws: number; matches: number } | null;
}

export interface CompetitiveMatchDetail {
  matchId: string;
  at: number;
  closedAt: number | null;
  outcome: MatchOutcome;
  lifecycle: CompetitiveMatchRow["lifecycle"];
  rival: PublicPlayer;
  view: DuelMatchView;
  rating: RatingEvent | null;
}

/* ───────────────────────────── filas ───────────────────────────── */

interface RatingRow { user_id: string; rating: number; games_played: number; wins: number; losses: number; draws: number; updated_at: string }
const RATING_COLS = "user_id, rating, games_played, wins, losses, draws, updated_at";

interface MatchRow {
  id: string; user_id: string; player_b_id: string | null; status: string; winner: "A" | "B" | null;
  closed_reason: string | null; closed_by: string | null; closed_at: string | null; created_at: string; updated_at: string;
  scoreA?: number | null; scoreB?: number | null; turns?: number | null;
}
const MATCH_COLS = "id, user_id, player_b_id, status, winner, closed_reason, closed_by, closed_at, created_at, updated_at, scoreA:state->scoreA, scoreB:state->scoreB";

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

function facts(r: MatchRow): MatchFacts {
  return {
    status: r.status, winner: r.winner,
    closedReason: r.closed_reason === "ABANDONED" || r.closed_reason === "EXPIRED" ? r.closed_reason : null,
    closedBy: r.closed_by, playerAId: r.user_id, playerBId: r.player_b_id ?? "",
  };
}

const lifecycleOfRow = (r: MatchRow): CompetitiveMatchRow["lifecycle"] =>
  r.closed_reason === "ABANDONED" ? "ABANDONED" : r.closed_reason === "EXPIRED" ? "EXPIRED"
    : r.status === "IN_PROGRESS" ? "IN_TURN" : r.status === "WAITING" ? "CREATED" : "FINISHED";

/** Solo lo público del perfil. `username`/`avatar`; nada más sale de aquí. */
async function publicPlayers(sb: SupabaseClient, ids: string[]): Promise<Map<string, PublicPlayer>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, PublicPlayer>();
  if (unique.length === 0) return out;
  const { data } = await sb.from("profiles").select("id, username, avatar").in("id", unique);
  for (const r of (data ?? []) as { id: string; username: string; avatar: string | null }[]) {
    out.set(r.id, { userId: r.id, username: r.username, avatar: r.avatar ?? "🎮" });
  }
  for (const id of unique) if (!out.has(id)) out.set(id, { userId: id, username: "Jugador", avatar: "🎮" });
  return out;
}

/* ───────────────────────────── temporada competitiva (F84) ───────────────────────────── */

interface SeasonRow {
  id: string; number: number; name: string; status: string; starts_at: string; ends_at: string | null; game_season_id: string | null;
  rank_config_version: string; formula_version: string; placement_games: number;
  config: { top?: { size?: number; minSeasonMatches?: number; activeDays?: number }; pairCap?: { matches?: number; hours?: number } } | null;
}
const SEASON_COLS = "id, number, name, status, starts_at, ends_at, game_season_id, rank_config_version, formula_version, placement_games, config";

function toSeason(r: SeasonRow): CompetitiveSeasonInfo {
  const top = r.config?.top ?? {}, cap = r.config?.pairCap ?? {};
  return {
    id: r.id, number: r.number, name: r.name, startsAt: ms(r.starts_at), endsAt: r.ends_at ? ms(r.ends_at) : null,
    rankConfigVersion: r.rank_config_version, formulaVersion: r.formula_version, placementGames: r.placement_games,
    top: { size: Number(top.size ?? 500), minSeasonMatches: Number(top.minSeasonMatches ?? 5), activeDays: Number(top.activeDays ?? 14) },
    pairCap: { matches: Number(cap.matches ?? 5), hours: Number(cap.hours ?? 24) },
    gameSeasonId: r.game_season_id,
  };
}

/**
 * F84 · Temporada competitiva ACTIVA (publicada, empezada y sin terminar) por el reloj del servidor. La liquidación usa
 * el mismo criterio con el reloj de la BD (`competitive_active_season()`); la frontera se mide en segundos, no importa.
 */
export async function readActiveCompetitiveSeason(sb: SupabaseClient, now: number = Date.now()): Promise<CompetitiveSeasonInfo | null> {
  const { data, error } = await sb.from("competitive_seasons").select(SEASON_COLS).eq("status", "PUBLISHED")
    .lte("starts_at", new Date(now).toISOString()).order("starts_at", { ascending: false }).limit(3);
  // Sin 0065 (BD anterior a F84): el competitivo sigue sirviendo sin temporada competitiva; /api/ready lo marca (check «ranked»).
  if (error) { if (isMissingRelation(error)) return null; throw new Error(error.message); }
  const row = ((data ?? []) as SeasonRow[]).find((r) => !r.ends_at || ms(r.ends_at) > now);
  return row ? toSeason(row) : null;
}

interface SeasonPlayerRow {
  matches: number; wins: number; losses: number; draws: number; seed_rating: number; placement_completed_at: string | null;
  peak_rating: number; peak_ranked_rating: number | null; last_match_at: string;
}
const SEASON_PLAYER_COLS = "matches, wins, losses, draws, seed_rating, placement_completed_at, peak_rating, peak_ranked_rating, last_match_at";

export async function readSeasonRecord(sb: SupabaseClient, seasonId: string, userId: string): Promise<SeasonRecordRow | null> {
  const { data, error } = await sb.from("competitive_season_players").select(SEASON_PLAYER_COLS).eq("season_id", seasonId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  const r = data as SeasonPlayerRow | null;
  if (!r) return null;
  return {
    matches: r.matches, wins: r.wins, losses: r.losses, draws: r.draws, seedRating: r.seed_rating,
    placementCompletedAt: r.placement_completed_at ? ms(r.placement_completed_at) : null,
    peakRating: r.peak_rating, peakRankedRating: r.peak_ranked_rating, lastMatchAt: ms(r.last_match_at),
  };
}

/** Estado competitivo de UN jugador (temporada activa + récord + rating). Una lectura de récord si hay temporada. */
export async function standingOf(sb: SupabaseClient, season: CompetitiveSeasonInfo | null, userId: string, rating: number): Promise<{ standing: CompetitiveStanding; record: SeasonRecordRow | null }> {
  const record = season ? await readSeasonRecord(sb, season.id, userId) : null;
  return { standing: competitiveStanding({ rating, season, record }), record };
}

/**
 * F85 · RANGO VISIBLE EN LOTE (social: amigos, solicitudes, búsqueda, recientes). Tres lecturas acotadas para N jugadores
 * (temporada activa, fichas de rating, récords de temporada): sin N+1. Mismo criterio que `competitiveStanding`.
 */
export interface RankBadge { state: CompetitiveStanding["state"]; label: string; rank: RankChip | null }
export async function rankBadgesOf(sb: SupabaseClient, ids: string[]): Promise<Map<string, RankBadge>> {
  const out = new Map<string, RankBadge>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;
  const season = await readActiveCompetitiveSeason(sb).catch(() => null);
  const [ratings, records] = await Promise.all([
    sb.from("duel_pvp_ratings").select("user_id, rating").in("user_id", unique),
    season ? sb.from("competitive_season_players").select(`user_id, ${SEASON_PLAYER_COLS}`).eq("season_id", season.id).in("user_id", unique) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const rating = new Map(((ratings.data ?? []) as { user_id: string; rating: number }[]).map((r) => [r.user_id, r.rating]));
  const rec = new Map(((records.data ?? []) as (SeasonPlayerRow & { user_id: string })[]).map((r) => [r.user_id, r]));
  for (const id of unique) {
    const r = rec.get(id);
    const record: SeasonRecordRow | null = r ? {
      matches: r.matches, wins: r.wins, losses: r.losses, draws: r.draws, seedRating: r.seed_rating,
      placementCompletedAt: r.placement_completed_at ? ms(r.placement_completed_at) : null, peakRating: r.peak_rating,
      peakRankedRating: r.peak_ranked_rating, lastMatchAt: ms(r.last_match_at),
    } : null;
    const st = competitiveStanding({ rating: rating.get(id) ?? INITIAL_RATING, season, record });
    out.set(id, { state: st.state, label: standingLabel(st), rank: st.rank ? rankChip(st.rank) : null });
  }
  return out;
}

/* ───────────────────────────── escalera ───────────────────────────── */

/*
 * F84 · LA CLASIFICACIÓN es la vista `competitive_ladder` (0065): jugadores de la temporada activa con la colocación
 * completa, el mínimo de partidas y actividad reciente, con su rating CANÓNICO (join, no copia). Mismo orden documentado
 * que la escalera F28/F55 (rating desc → updated_at asc → user_id asc) y las mismas consultas acotadas: tres recuentos
 * `head` para la posición y lecturas `range`. El tope del Top (500) se aplica al leer: nunca se descarga la escalera.
 */
interface LadderViewRow extends RatingRow { season_matches: number; season_wins: number; season_losses: number; season_draws: number; last_match_at: string }
const LADDER_COLS = `${RATING_COLS}, season_matches, season_wins, season_losses, season_draws, last_match_at`;

/** Recuento acotado de quién va por delante, con el orden documentado. Tres `head` counts. */
async function rankedAboveOf(sb: SupabaseClient, seasonId: string, self: Pick<RatingRow, "user_id" | "rating" | "updated_at">): Promise<number> {
  const base = () => sb.from("competitive_ladder").select("user_id", { count: "exact", head: true }).eq("season_id", seasonId);
  const [a, b, c] = await Promise.all([
    base().gt("rating", self.rating),
    base().eq("rating", self.rating).lt("updated_at", self.updated_at),
    base().eq("rating", self.rating).eq("updated_at", self.updated_at).lt("user_id", self.user_id),
  ]);
  return (a.count ?? 0) + (b.count ?? 0) + (c.count ?? 0);
}

/** Elegibles de la temporada (sin tope). */
async function eligibleTotal(sb: SupabaseClient, seasonId: string): Promise<number> {
  const { count } = await sb.from("competitive_ladder").select("user_id", { count: "exact", head: true }).eq("season_id", seasonId);
  return count ?? 0;
}

async function ladderSlice(sb: SupabaseClient, seasonId: string, from: number, to: number): Promise<LadderViewRow[]> {
  if (to <= from) return [];
  // El MISMO orden que `compareLadder` (documentado): rating desc → updated_at asc → user_id asc.
  const { data, error } = await sb.from("competitive_ladder").select(LADDER_COLS).eq("season_id", seasonId)
    .order("rating", { ascending: false }).order("updated_at", { ascending: true }).order("user_id", { ascending: true })
    .range(from, to - 1);
  if (error) throw new Error(error.message);
  return (data ?? []) as LadderViewRow[];
}

/** Mi fila en la clasificación (si soy elegible) para posicionarme con el `updated_at` exacto de la ficha. */
async function ladderRowOf(sb: SupabaseClient, seasonId: string, userId: string): Promise<LadderViewRow | null> {
  const { data, error } = await sb.from("competitive_ladder").select(LADDER_COLS).eq("season_id", seasonId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LadderViewRow | null) ?? null;
}

/** Posición en el Top (1-based, ≤ tamaño del Top) o `null` si no es elegible o queda fuera del tope. */
async function topPositionOf(sb: SupabaseClient, season: CompetitiveSeasonInfo, userId: string): Promise<{ position: number | null; row: LadderViewRow | null }> {
  const row = await ladderRowOf(sb, season.id, userId);
  if (!row) return { position: null, row: null };
  const p = (await rankedAboveOf(sb, season.id, row)) + 1;
  return { position: p <= season.top.size ? p : null, row };
}

function toEntries(rows: LadderViewRow[], firstPosition: number, players: Map<string, PublicPlayer>, selfId: string, version: string): LadderEntry[] {
  return rows.map((r, i) => ({
    ...(players.get(r.user_id) ?? { userId: r.user_id, username: "Jugador", avatar: "🎮" }),
    position: firstPosition + i,
    rating: r.rating, gamesPlayed: r.games_played, wins: r.wins, losses: r.losses, draws: r.draws,
    provisional: r.games_played < LIMITS_PLACEMENT, isSelf: r.user_id === selfId,
    rank: rankChip(deriveRank(r.rating, version)),
    season: { matches: r.season_matches, wins: r.season_wins, losses: r.season_losses, draws: r.season_draws, lastMatchAt: ms(r.last_match_at) },
  }));
}
const LIMITS_PLACEMENT = 10;

/* ───────────────────────────── partidas ───────────────────────────── */

async function matchesOf(sb: SupabaseClient, userId: string, limit: number, before: number | null): Promise<MatchRow[]> {
  let q = sb.from("duel_matches").select(MATCH_COLS)
    .eq("mode", "PVP")
    .or(`user_id.eq.${userId},player_b_id.eq.${userId}`)
    .or("status.in.(COMPLETED,DRAW,UNRESOLVED),closed_reason.not.is.null")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (before !== null && Number.isFinite(before)) q = q.lt("updated_at", new Date(before).toISOString());
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as MatchRow[];
}

async function ratingEventsFor(sb: SupabaseClient, userId: string, matchIds: string[]): Promise<Map<string, { before: number; delta: number; after: number }>> {
  const out = new Map<string, { before: number; delta: number; after: number }>();
  if (matchIds.length === 0) return out;
  const { data } = await sb.from("duel_pvp_rating_events").select("match_id, old_rating, delta, new_rating")
    .eq("user_id", userId).in("match_id", matchIds);
  for (const r of (data ?? []) as { match_id: string; old_rating: number; delta: number; new_rating: number }[]) {
    out.set(r.match_id, { before: r.old_rating, delta: r.delta, after: r.new_rating });
  }
  return out;
}

async function rowsToHistory(sb: SupabaseClient, userId: string, rows: MatchRow[]): Promise<CompetitiveMatchRow[]> {
  const rivals = rows.map((r) => (r.user_id === userId ? r.player_b_id ?? "" : r.user_id));
  const [players, events] = await Promise.all([publicPlayers(sb, rivals), ratingEventsFor(sb, userId, rows.map((r) => r.id))]);
  return rows.map((r) => {
    const side = sideOf(facts(r), userId);
    const o = outcomeFor(facts(r), userId);
    const rivalId = r.user_id === userId ? r.player_b_id ?? "" : r.user_id;
    const sa = Number(r.scoreA ?? 0), sb2 = Number(r.scoreB ?? 0);
    return {
      matchId: r.id, at: ms(r.updated_at) || ms(r.created_at), outcome: o, letter: letterOf(o),
      scoreYou: side === "B" ? sb2 : sa, scoreRival: side === "B" ? sa : sb2,
      rival: players.get(rivalId) ?? { userId: rivalId, username: "Jugador", avatar: "🎮" },
      rating: events.get(r.id) ?? null, turns: 0, lifecycle: lifecycleOfRow(r),
    };
  });
}

function statsFrom(rating: DuelRating | null, outcomes: MatchOutcome[]): CompetitiveStats {
  const form = recentForm(outcomes, 10);
  return {
    matches: rating?.gamesPlayed ?? 0, wins: rating?.wins ?? 0, losses: rating?.losses ?? 0, draws: rating?.draws ?? 0,
    winrate: rating ? winrate(rating.wins, rating.losses, rating.draws) : null,
    form, streak: streak(form),
  };
}

/* ───────────────────────────── operaciones ───────────────────────────── */

/**
 * FASE 41 · GET SIN ESCRITURAS. Antes el snapshot llamaba a `ensureRating` (INSERT de la ficha 1000/0 la primera vez)
 * y a `getProgression` (sortea/rota misiones y abre el carril competitivo AL LEER): abrir `/cuenta` recién registrado
 * creaba filas. Ahora se lee la ficha tal cual —sin ficha, se enseña la inicial (1000, 0 partidas) sin crearla— y la
 * progresión con `peekProgression` (misma vista, cero escrituras). La ficha la sigue creando quien juega (PvP).
 */
async function readRating(sb: SupabaseClient, userId: string): Promise<DuelRating> {
  const { data, error } = await sb.from("duel_pvp_ratings").select("user_id, rating, games_played, wins, losses, draws, updated_at").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data as RatingRow | null) ?? null;
  if (!row) return { rating: INITIAL_RATING, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, provisional: isProvisional(0), updatedAt: 0 };
  return {
    rating: row.rating, gamesPlayed: row.games_played, wins: row.wins, losses: row.losses, draws: row.draws,
    provisional: isProvisional(row.games_played), updatedAt: Date.parse(row.updated_at) || 0,
  };
}

export async function getCompetitiveSnapshot(sb: SupabaseClient, userId: string, opts: { top?: number } = {}): Promise<CompetitiveResult<CompetitiveSnapshot>> {
  const now = Date.now();
  try {
    const [rating, cseason] = await Promise.all([readRating(sb, userId), readActiveCompetitiveSeason(sb, now)]);
    const topSize = cseason ? cseason.top.size : 0;
    const top = Math.min(clampLimit(opts.top, LIMITS.top, LIMITS.topMax), Math.max(1, topSize));

    const [mine, eligible, topRows, matches, history, highest, prog, season, own] = await Promise.all([
      cseason ? topPositionOf(sb, cseason, userId) : Promise.resolve({ position: null, row: null }),
      cseason ? eligibleTotal(sb, cseason.id) : Promise.resolve(0),
      cseason ? ladderSlice(sb, cseason.id, 0, top) : Promise.resolve([] as LadderViewRow[]),
      matchesOf(sb, userId, LIMITS.history + 1, null),
      getRatingHistory(sb, userId, LIMITS.ratingHistory),
      sb.from("duel_pvp_rating_events").select("new_rating").eq("user_id", userId).order("new_rating", { ascending: false }).limit(1),
      peekProgression(sb, userId).catch(() => null),
      readSeason(sb, userId, now),
      standingOf(sb, cseason, userId, rating.rating),
    ]);
    const position = mine.position;
    const total = Math.min(eligible, topSize);

    // Alrededor de mí: una sola lectura acotada de la ventana; el top ya está y se deduplica.
    let around: LadderViewRow[] = [];
    if (cseason && position !== null) {
      const w = aroundWindow(position, total, LIMITS.around, LIMITS.around);
      around = await ladderSlice(sb, cseason.id, w.from, w.to);
    }
    // Puntos para pasar al de delante: el inmediato anterior en la ventana.
    const idx = around.findIndex((r) => r.user_id === userId);
    const aboveRow = idx > 0 ? around[idx - 1] : null;
    const pointsToAbove = aboveRow ? Math.max(0, aboveRow.rating - rating.rating + 1) : null;

    const version = cseason?.rankConfigVersion ?? "";
    const players = await publicPlayers(sb, [...topRows.map((r) => r.user_id), ...around.map((r) => r.user_id)]);
    const topEntries = toEntries(topRows, 1, players, userId, version);
    const aroundStart = position !== null ? aroundWindow(position, total, LIMITS.around, LIMITS.around).from + 1 : 1;
    const aroundEntries = dedupeAround(topEntries, toEntries(around, aroundStart, players, userId, version));

    const hasMore = matches.length > LIMITS.history;
    const pageRows = matches.slice(0, LIMITS.history);
    const recent = await rowsToHistory(sb, userId, pageRows);
    const outcomes = recent.map((m) => m.outcome);

    // Cartas: las últimas partidas con sus turnos (acotado a 10 partidas, una lectura).
    const cards = await cardStats(sb, userId, pageRows.slice(0, 10).map((r) => r.id));

    const highestRow = ((highest.data ?? []) as { new_rating: number }[])[0];
    const rewardsView = prog?.ok && prog.data ? prog.data.view : null;
    const lastMatchAt = own.record?.lastMatchAt ?? null;

    return done({
      serverNow: now,
      self: {
        rating, position, rankedTotal: total, percentile: percentile(position, total), pointsToAbove,
        highestRating: highestRating(highestRow ? [highestRow.new_rating] : []),
        placementGames: cseason?.placementGames ?? LIMITS_PLACEMENT,
      },
      stats: statsFrom(rating, outcomes),
      leaderboardTop: topEntries,
      aroundMe: aroundEntries,
      recentMatches: recent,
      nextBefore: hasMore && pageRows.length > 0 ? recent[recent.length - 1].at : null,
      ratingSeries: ratingSeries(history.ok && history.data ? history.data : []),
      cards,
      rewards: {
        unlocked: rewardsView?.competitiveUnlocked ?? false,
        minPoints: rewardsView?.competitiveMinPoints ?? 0,
        points: rewardsView?.points ?? 0,
        levels: rewardsView?.tracks.competitive ?? [],
        passLevel: rewardsView?.level ?? 0,
      },
      season,
      competitive: {
        season: cseason, standing: own.standing,
        eligibility: cseason ? topEligibility(own.standing, lastMatchAt, cseason.top, now) : null,
        lastMatchAt, eligibleTotal: eligible,
      },
    });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer el competitivo");
  }
}

/** Tope de asientos leídos para el récord de temporada: si se alcanza, el récord lo dice (`truncated`). */
export const SEASON_EVENTS_CAP = 500;

/**
 * FASE 55 · Temporada activa (calendario canónico, reloj del servidor) + récord ranked dentro de su ventana,
 * leído de los asientos reales. Una consulta acotada; sin temporada activa, `null` y ninguna lectura.
 */
async function readSeason(sb: SupabaseClient, userId: string, now: number): Promise<CompetitiveSeason | null> {
  const cal = resolveCalendar(loadSeasonCalendar(), now);
  if (!cal.ok || !cal.current) return null;
  const s = cal.current;
  const { data, error } = await sb.from("duel_pvp_rating_events").select("old_rating, delta, new_rating, result, created_at")
    .eq("user_id", userId)
    .gte("created_at", new Date(s.startsAtMs).toISOString()).lt("created_at", new Date(s.endsAtMs).toISOString())
    .order("created_at", { ascending: false }).limit(SEASON_EVENTS_CAP);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { old_rating: number; delta: number; new_rating: number; result: "WIN" | "LOSS" | "DRAW"; created_at: string }[];
  const record = seasonRecord(
    rows.map((r) => ({ createdAt: ms(r.created_at), delta: r.delta, newRating: r.new_rating, oldRating: r.old_rating, result: r.result })),
    { startsAtMs: s.startsAtMs, endsAtMs: s.endsAtMs },
    rows.length >= SEASON_EVENTS_CAP,
  );
  return {
    id: s.id, name: s.name, displayName: s.displayName, startsAt: s.startsAtMs, endsAt: s.endsAtMs,
    remainingMs: s.remainingMs, presentation: s.presentation, record, resetsRating: false,
  };
}

/**
 * FASE 55 · Página de la escalera: `offset` 0-based alineado a `size` (≤ 50). Mismo orden y mismos campos
 * públicos que el top. Nunca descarga la escalera entera: una lectura `range` + recuentos `head`.
 */
export async function getCompetitiveLadderPage(sb: SupabaseClient, userId: string, opts: { offset?: unknown; size?: unknown } = {}): Promise<CompetitiveResult<CompetitiveLadderPage>> {
  try {
    const cseason = await readActiveCompetitiveSeason(sb);
    if (!cseason) {
      const page = ladderPage(opts.offset, 0, opts.size);
      return done({ offset: 0, size: page.size, total: 0, hasPrev: false, hasNext: false, entries: [], selfPosition: null, selfPageOffset: null });
    }
    const [eligible, mine] = await Promise.all([eligibleTotal(sb, cseason.id), topPositionOf(sb, cseason, userId)]);
    // F84 · el Top enseña como mucho `top.size` (500): con 83 elegibles, 1–83; nunca se fabrican filas.
    const total = Math.min(eligible, cseason.top.size);
    const page = ladderPage(opts.offset, total, opts.size);
    const rows = await ladderSlice(sb, cseason.id, page.offset, Math.min(total, page.offset + page.size));
    const players = await publicPlayers(sb, rows.map((r) => r.user_id));
    const selfPosition = mine.position;
    return done({
      offset: page.offset, size: page.size, total, hasPrev: page.hasPrev, hasNext: page.hasNext,
      entries: toEntries(rows, page.offset + 1, players, userId, cseason.rankConfigVersion),
      selfPosition, selfPageOffset: selfPosition !== null ? page.pageOf(selfPosition) : null,
    });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer la clasificación");
  }
}

/**
 * FASE 55 · «RIVAL ENCONTRADO». Los dos lados de una partida ranked (`mode = 'PVP'`) EN CURSO o terminada, solo
 * para sus dos jugadores (404 a cualquier otro, igual que el detalle). De cada lado: nombre, avatar, rating,
 * partidas y puesto —lo mismo que ya es público en la escalera—. Nada del mazo ni de la mano del rival.
 */
export async function getCompetitiveMatchup(sb: SupabaseClient, viewerId: string, matchId: string): Promise<CompetitiveResult<CompetitiveMatchup>> {
  try {
    const { data, error } = await sb.from("duel_matches").select("id, mode, user_id, player_b_id").eq("id", matchId).maybeSingle();
    if (error) return fail(500, error.message);
    const r = data as { id: string; mode: string; user_id: string; player_b_id: string | null } | null;
    if (!r || r.mode !== "PVP" || !r.player_b_id) return fail(404, "Partida no encontrada", "NOT_PVP");
    if (viewerId !== r.user_id && viewerId !== r.player_b_id) return fail(404, "Partida no encontrada", "NOT_A_PLAYER");
    const rivalId = viewerId === r.user_id ? r.player_b_id : r.user_id;
    const cseason = await readActiveCompetitiveSeason(sb);
    const [players, mine, theirs] = await Promise.all([
      publicPlayers(sb, [viewerId, rivalId]), readCompetitivePosition(sb, viewerId, cseason), readCompetitivePosition(sb, rivalId, cseason),
    ]);
    const side = async (id: string, p: typeof mine): Promise<CompetitiveMatchupSide> => {
      const row = p.ok && p.data ? p.data.row : null;
      const rating = row?.rating ?? INITIAL_RATING;
      const { standing } = await standingOf(sb, cseason, id, rating);
      return {
        ...(players.get(id) ?? { userId: id, username: "Jugador", avatar: "🎮" }),
        rating, gamesPlayed: row?.games_played ?? 0,
        provisional: isProvisional(row?.games_played ?? 0), position: p.ok && p.data ? p.data.position : null,
        rankLabel: standingLabel(standing), rank: standing.rank ? rankChip(standing.rank) : null,
      };
    };
    const [you, rival] = await Promise.all([side(viewerId, mine), side(rivalId, theirs)]);
    const total = mine.ok && mine.data ? mine.data.rankedTotal : 0;
    return done({ matchId: r.id, you, rival, rivalKind: "HUMAN", rankedTotal: total });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer el emparejamiento");
  }
}

/** Página del historial (cursor por `updated_at`). */
export async function getCompetitiveHistory(sb: SupabaseClient, userId: string, opts: { before?: number | null; limit?: number } = {}): Promise<CompetitiveResult<{ matches: CompetitiveMatchRow[]; nextBefore: number | null }>> {
  const limit = clampLimit(opts.limit, LIMITS.history, LIMITS.historyMax);
  try {
    const rows = await matchesOf(sb, userId, limit + 1, opts.before ?? null);
    const page = rows.slice(0, limit);
    const matches = await rowsToHistory(sb, userId, page);
    return done({ matches, nextBefore: rows.length > limit && matches.length > 0 ? matches[matches.length - 1].at : null });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer el historial");
  }
}

/** Cartas del propio jugador en sus últimas partidas: usos y turnos ganados. Nunca del rival. */
async function cardStats(sb: SupabaseClient, userId: string, matchIds: string[]): Promise<CompetitiveSnapshot["cards"]> {
  if (matchIds.length === 0) return { mostUsed: null, mostWinning: null, sample: 0 };
  const { data } = await sb.from("duel_matches").select("id, user_id, player_b_id, state->turns").in("id", matchIds);
  const facts: { uid: string; cardId: string; nick: string; won: boolean }[] = [];
  for (const r of (data ?? []) as { id: string; user_id: string; player_b_id: string | null; turns: DuelMatch["turns"] | null }[]) {
    const side = r.user_id === userId ? "A" : r.player_b_id === userId ? "B" : null;
    if (!side || !Array.isArray(r.turns)) continue;
    for (const t of r.turns) {
      const mine = side === "A" ? t.encounter.a : t.encounter.b;
      facts.push({ uid: mine.uid, cardId: mine.cardId, nick: mine.playerName, won: t.outcome === side });
    }
  }
  const perf = cardPerformance(facts);
  return { mostUsed: perf.mostUsed, mostWinning: perf.mostWinning, sample: (data ?? []).length };
}

/** Perfil competitivo PÚBLICO de otro jugador (o propio). Solo campos públicos. */
export async function getCompetitivePlayer(sb: SupabaseClient, viewerId: string, playerId: string): Promise<CompetitiveResult<CompetitivePlayerView>> {
  try {
    const players = await publicPlayers(sb, [playerId]);
    const { data: exists } = await sb.from("profiles").select("id").eq("id", playerId).maybeSingle();
    if (!exists) return fail(404, "Jugador no encontrado");
    const player = players.get(playerId)!;

    const { data: rrow } = await sb.from("duel_pvp_ratings").select(RATING_COLS).eq("user_id", playerId).maybeSingle();
    const row = rrow as RatingRow | null;
    const rating: DuelRating | null = row ? {
      rating: row.rating, gamesPlayed: row.games_played, wins: row.wins, losses: row.losses, draws: row.draws,
      provisional: row.games_played < LIMITS_PLACEMENT, updatedAt: ms(row.updated_at),
    } : null;
    const cseason = await readActiveCompetitiveSeason(sb);
    const [pos, rows, own] = await Promise.all([
      readCompetitivePosition(sb, playerId, cseason),
      matchesOf(sb, playerId, LIMITS.history, null),
      standingOf(sb, cseason, playerId, row?.rating ?? INITIAL_RATING),
    ]);
    const total = pos.ok && pos.data ? pos.data.rankedTotal : 0;
    const position = pos.ok && pos.data ? pos.data.position : null;
    const recent = await rowsToHistory(sb, playerId, rows);

    let h2h: CompetitivePlayerView["h2h"] = null;
    if (playerId !== viewerId) {
      const { data } = await sb.from("duel_matches").select(MATCH_COLS).eq("mode", "PVP")
        .or(`and(user_id.eq.${viewerId},player_b_id.eq.${playerId}),and(user_id.eq.${playerId},player_b_id.eq.${viewerId})`)
        .or("status.in.(COMPLETED,DRAW,UNRESOLVED),closed_reason.not.is.null")
        .order("updated_at", { ascending: false }).limit(50);
      const f = ((data ?? []) as MatchRow[]).map(facts);
      const r = headToHead(f, viewerId, playerId);
      h2h = { ...r, matches: r.wins + r.losses + r.draws };
    }

    return done({
      player, rating, position, rankedTotal: total,
      competitive: {
        season: cseason ? { id: cseason.id, name: cseason.name, number: cseason.number, placementGames: cseason.placementGames, rankConfigVersion: cseason.rankConfigVersion } : null,
        standing: own.standing,
      },
      stats: statsFrom(rating, recent.map((m) => m.outcome)),
      recentMatches: recent.map(({ matchId, at, outcome, letter, scoreYou, scoreRival, rival }) => ({ matchId, at, outcome, letter, scoreYou, scoreRival, rival })),
      h2h,
    });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer el jugador");
  }
}

/** Detalle de una partida PvP terminada. Solo sus dos participantes; el resto recibe 404. */
export async function getCompetitiveMatch(sb: SupabaseClient, viewerId: string, matchId: string): Promise<CompetitiveResult<CompetitiveMatchDetail>> {
  try {
    await serverCatalog(sb);
    const { data, error } = await sb.from("duel_matches")
      .select("id, mode, user_id, player_b_id, status, winner, closed_reason, closed_by, closed_at, created_at, updated_at, state")
      .eq("id", matchId).maybeSingle();
    if (error) return fail(500, error.message);
    const r = data as (MatchRow & { mode: string; state: DuelMatch }) | null;
    if (!r || r.mode !== "PVP") return fail(404, "Partida no encontrada", "NOT_PVP");
    const side = sideOf(facts(r), viewerId);
    if (!side) return fail(404, "Partida no encontrada", "NOT_A_PLAYER");
    const lifecycle = lifecycleOfRow(r);
    if (lifecycle === "IN_TURN" || lifecycle === "CREATED") return fail(409, "La partida no ha terminado", "NOT_FINISHED");

    const rivalId = side === "A" ? r.player_b_id ?? "" : r.user_id;
    const [players, ev] = await Promise.all([
      publicPlayers(sb, [rivalId]),
      sb.from("duel_pvp_rating_events").select("match_id, old_rating, delta, new_rating, opponent_rating, k_factor, result, created_at")
        .eq("match_id", matchId).eq("user_id", viewerId).maybeSingle(),
    ]);
    const rival = players.get(rivalId)!;
    // REDACCIÓN: lo no jugado del rival no viaja aunque la partida haya terminado (abandono/tiempo).
    const projected = projectMatchFor(r.state, side, (pid) => serverCatalogSync().registry.player(pid)?.country ?? "", visualHintValue);
    const view = buildMatchView(projected, { side, registry: serverCatalogSync().registry, difficulty: "NORMAL", rivalLabel: rival.username });
    const e = ev.data as { match_id: string; old_rating: number; delta: number; new_rating: number; opponent_rating: number; k_factor: number; result: RatingEvent["result"]; created_at: string } | null;
    return done({
      matchId: r.id, at: ms(r.created_at), closedAt: r.closed_at ? ms(r.closed_at) : null,
      outcome: outcomeFor(facts(r), viewerId), lifecycle, rival, view,
      rating: e ? { matchId: e.match_id, oldRating: e.old_rating, delta: e.delta, newRating: e.new_rating, opponentRating: e.opponent_rating, kFactor: e.k_factor, result: e.result, createdAt: ms(e.created_at) } : null,
    });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer la partida");
  }
}

/**
 * FASE 34 · Posición propia SIN crear la ficha de rating. `getCompetitivePosition` llama a
 * `ensureRating` (inserta la fila la primera vez); la temporada es una lectura pura, así que aquí se
 * lee la fila tal cual: si no existe, el jugador no tiene rating (`null`). Mismo orden de escalera.
 *
 * F84 · la posición es la de la CLASIFICACIÓN de la temporada competitiva activa (colocación + mínimo + actividad,
 * tope del Top): una sola definición de «puesto» para el centro competitivo, el perfil, el vestíbulo y la portada.
 * `rankedTotal` = jugadores en esa clasificación (como mucho el tamaño del Top).
 */
export async function readCompetitivePosition(sb: SupabaseClient, userId: string, season?: CompetitiveSeasonInfo | null): Promise<CompetitiveResult<{ row: RatingRow | null; position: number | null; rankedTotal: number }>> {
  try {
    const cseason = season === undefined ? await readActiveCompetitiveSeason(sb) : season;
    const { data, error } = await sb.from("duel_pvp_ratings").select("user_id, rating, games_played, wins, losses, draws, updated_at").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data as RatingRow | null) ?? null;
    if (!cseason) return done({ row, position: null, rankedTotal: 0 });
    const [mine, eligible] = await Promise.all([topPositionOf(sb, cseason, userId), eligibleTotal(sb, cseason.id)]);
    return done({ row, position: mine.position, rankedTotal: Math.min(eligible, cseason.top.size) });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer la posición");
  }
}

/**
 * FASE 56 · Vecinos PÚBLICOS de un puesto (el de delante y el de detrás) para el perfil de jugador: una lectura
 * `range` de 3 filas con el orden de la escalera y los nombres públicos. Nada que no esté ya en la clasificación.
 */
export async function readLadderNeighbors(sb: SupabaseClient, position: number): Promise<{ above: { userId: string; username: string; position: number; rating: number } | null; below: { userId: string; username: string; position: number; rating: number } | null }> {
  if (!Number.isInteger(position) || position < 1) return { above: null, below: null };
  const cseason = await readActiveCompetitiveSeason(sb);
  if (!cseason) return { above: null, below: null };
  const from = Math.max(0, position - 2);
  const rows = await ladderSlice(sb, cseason.id, from, Math.min(position + 1, cseason.top.size));
  const players = await publicPlayers(sb, rows.map((r) => r.user_id));
  const at = (pos: number) => {
    const r = rows[pos - 1 - from];
    if (!r || pos < 1) return null;
    const p = players.get(r.user_id);
    return { userId: r.user_id, username: p?.username ?? "Jugador", position: pos, rating: r.rating };
  };
  return { above: position > 1 ? at(position - 1) : null, below: at(position + 1) };
}

/** Solo la posición propia (barata): para la foto «antes/después» del post-partida. */
export async function getCompetitivePosition(sb: SupabaseClient, userId: string): Promise<CompetitiveResult<{ rating: number; position: number | null; rankedTotal: number; gamesPlayed: number; seasonMatches: number; rankLabel: string }>> {
  try {
    // Fase 41 · lectura pura (antes `ensureRating`): sin ficha, 1000 sin posición.
    const [rating, cseason] = await Promise.all([readRating(sb, userId), readActiveCompetitiveSeason(sb)]);
    const [pos, own] = await Promise.all([readCompetitivePosition(sb, userId, cseason), standingOf(sb, cseason, userId, rating.rating)]);
    const position = pos.ok && pos.data ? pos.data.position : null;
    const total = pos.ok && pos.data ? pos.data.rankedTotal : 0;
    // Fase 55 · `gamesPlayed` (de por vida) · F84 · partidas de la temporada y etiqueta de rango para la foto.
    return done({ rating: rating.rating, position, rankedTotal: total, gamesPlayed: rating.gamesPlayed, seasonMatches: own.standing.record.matches, rankLabel: standingLabel(own.standing) });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer la posición");
  }
}
