/**
 * SOCIAL 1.0 — SERVICIO (Fase 29, SOLO SERVIDOR) · F85 SOCIAL 2.0.
 *
 * Amigos, solicitudes, bloqueos, presencia, búsqueda, retos y duelos privados, sobre tablas REALES:
 * `duel_friendships` (una fila por par canónico), `social_blocks` (F85: un bloqueo por dirección), `duel_challenges`,
 * `profiles.last_seen_at` (latido) y `duel_matches` con `mode in ('PVP','PVP_PRIVATE')`. Migraciones 0048 y 0066.
 *
 * AUTORIDAD. Cada transición de amistad/reto la decide UNA RPC atómica en Postgres (cerrojo de la pareja + fila):
 * doble clic, dos pestañas, solicitudes cruzadas, aceptar ‖ cancelar ‖ caducar ‖ bloquear ‖ dejar de ser amigos
 * convergen en un único resultado. Aquí no se «calcula» ningún estado: se pide, se traduce y se lee. El `userId` viene
 * SIEMPRE del token (`getSession`).
 *
 * DUELO AMISTOSO = `createPvpMatch(..., { mode: "PVP_PRIVATE" })`: mismo motor, reglas, validación de mazo, arena y
 * reconexión que el ranked. NO liquida rating (`isSettleable` + RPC rechazan), NO cuenta para colocación/Top/récord F84,
 * NO da misiones F73 ni XP de temporada F83 (los ganchos exigen `mode = 'PVP'`).
 *
 * PRIVACIDAD (F85). De otro jugador salen `username`, `avatar`, su rango F84 público y, si es público, su equipo
 * favorito F89. La PRESENCIA solo la ven sus amigos (y él mismo); nunca la hora exacta. Nada de correo, créditos, XP,
 * `is_admin`, mazos ni cartas. A quien me bloqueó no lo encuentro ni puedo interactuar (respuesta neutra: «no disponible»).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DuelRating } from "@/domain/cardgame/rating";
import { outcomeFor, letterOf, sideOf, type MatchFacts } from "@/domain/pvpLadder/ladder";
import {
  relationFor, actionsFor, presenceOf, sortFriends, effectiveStatus, directionOf, challengeActions, inboxOf, badgeCount,
  normalizeQuery, likePrefix, h2hSplit, recentOpponents, activityOf, CHALLENGE_TTL_SECONDS, PRESENCE_WINDOWS, SEARCH_LIMIT, SEARCH_MAX_OFFSET,
  FRIENDS_LIMIT, FRIENDS_PAGE, HEARTBEAT_WRITE_MIN_MS,
  type FriendshipRow, type RelationState, type Presence, type ChallengeRow, type ChallengeStatus, type ChallengeDirection,
  type InboxItem, type H2HSplit, type ActivityItem, type BlockFacts,
} from "@/domain/social/social";
import { teamFact, type FavoriteTeamFact } from "@/domain/profile/favoriteTeam";
import { createPvpMatch, resolveDeckSnapshot } from "./duelsPvp";
import { looksLikeTagQuery, normalizeTag } from "@/domain/account/tag";
import { rankBadgesOf, type RankBadge } from "./competitive";
import { roundName } from "@/domain/cups/bracket";

export interface SocialResult<T> { ok: boolean; status: number; error?: string; code?: string; data?: T }
const fail = (status: number, error: string, code?: string): SocialResult<never> => ({ ok: false, status, error, code });
const done = <T>(data: T): SocialResult<T> => ({ ok: true, status: 200, data });

/** F85 · log técnico estructurado SIN datos personales (ni ids, ni nombres): acción + código. */
function logSocial(action: string, code: string, extra?: string): void {
  console.error(`[social] action=${action} code=${code}${extra ? ` detail=${extra.slice(0, 120)}` : ""}`);
}

/* ───────────────────────────── tipos públicos ───────────────────────────── */

/** Lo ÚNICO que sale de `profiles` de otra persona. */
export interface SocialPlayer { userId: string; username: string; avatar: string }

export interface RatingSummary { rating: number; gamesPlayed: number; provisional: boolean }

/** F85 · identidad social compacta: rango F84 y equipo favorito F89 (si lo eligió; logo SOLO si ya existe). */
export interface SocialBadges { rank: RankBadge | null; team: Pick<FavoriteTeamFact, "id" | "name" | "tag" | "logo"> | null }

export interface FriendView extends SocialPlayer, SocialBadges {
  presence: Presence;
  /** F85 · ya no se publica la hora del último latido (siempre `null`; se conserva el campo por compatibilidad). */
  lastSeenAt: null;
  since: number;
  rating: RatingSummary | null;
}

export interface RequestView extends SocialBadges { player: SocialPlayer; at: number }

export interface ChallengeView {
  id: string;
  /** Estado EFECTIVO (un PENDING caducado por reloj del servidor ya sale como EXPIRED). */
  status: ChallengeStatus;
  direction: ChallengeDirection;
  challenger: SocialPlayer;
  challenged: SocialPlayer;
  matchId: string | null;
  previousMatchId: string | null;
  createdAt: number;
  expiresAt: number;
  respondedAt: number | null;
  actions: { accept: boolean; decline: boolean; cancel: boolean; open: boolean };
  /** F85 · rango del OTRO lado (para «David · Titular II te reta»). */
  rivalRank?: RankBadge | null;
  /** F85 · la partida del reto sigue VIVA (un MATCHED antiguo NO es «en partida»: su duelo terminó). */
  matchLive?: boolean;
}

export interface RecentOpponentView extends SocialPlayer, SocialBadges {
  lastAt: number;
  games: number;
  relation: RelationState;
  /** F85 · solo si sois amigos; si no, `null` (la presencia es privada). */
  presence: Presence | null;
}

export interface SocialCounts { friends: number; incoming: number; outgoing: number; challengesIn: number; challengesOut: number; blocked: number }

export interface SocialSnapshot {
  self: SocialPlayer;
  /** F86.2 · MI #TAG (0068, público por diseño) para que pueda copiarlo y pasárselo a un amigo desde aquí mismo. */
  selfTag: string | null;
  counts: SocialCounts;
  /** Primera página (≤ 100) ordenada por presencia; el resto por `?friends=1&offset=`. */
  friends: FriendView[];
  friendsLimit: number;
  incoming: RequestView[];
  outgoing: RequestView[];
  blocked: SocialPlayer[];
  /** Retos donde participo, más reciente primero (activos y recién cerrados). */
  challenges: ChallengeView[];
  recentOpponents: RecentOpponentView[];
  inbox: InboxItem[];
  badge: number;
  activity: ActivityItem[];
  /** Reloj del servidor en la lectura: el cliente solo lo usa para pintar cuentas atrás. */
  serverNow: number;
  presenceWindows: { onlineMs: number };
  challengeTtlSeconds: number;
  /** F85 · huella del estado social (cambia si cambia algo que la otra pestaña deba releer). */
  version: string;
}

/** 0068 · `tag` = tag público de la cuenta (canónico, sin «#»): público por diseño, como el nombre. */
export interface SearchHit extends SocialPlayer, SocialBadges { relation: RelationState; presence: Presence | null; rating: RatingSummary | null; tag: string | null }

export interface SocialSearchResult { query: string; players: SearchHit[]; limit: number; offset: number; hasMore: boolean }

export interface SocialPlayerView {
  player: SocialPlayer;
  relation: RelationState;
  actions: ReturnType<typeof actionsFor>;
  /** F85 · solo amigos (o uno mismo); si no, `null`. */
  presence: Presence | null;
  lastSeenAt: null;
  rating: DuelRating | null;
  rank: RankBadge | null;
  h2h: H2HSplit;
  /** Reto PENDING vivo entre los dos (en cualquier dirección), si lo hay. */
  pendingChallenge: ChallengeView | null;
  /** Últimos duelos privados entre ambos (sin cartas). */
  recentPrivate: { matchId: string; at: number; letter: "W" | "L" | "D" | null; scoreYou: number; scoreRival: number }[];
  friendsSince: number | null;
}

/* ───────────────────────────── filas ───────────────────────────── */

interface FriendshipDbRow { user_lo: string; user_hi: string; requester_id: string; status: string; blocked_by: string | null; created_at: string; responded_at: string | null }
const FRIENDSHIP_COLS = "user_lo, user_hi, requester_id, status, blocked_by, created_at, responded_at";

interface ChallengeDbRow {
  id: string; challenger_id: string; challenged_id: string; status: string; match_id: string | null; previous_match_id: string | null;
  created_at: string; expires_at: string; responded_at: string | null;
}
const CHALLENGE_COLS = "id, challenger_id, challenged_id, status, match_id, previous_match_id, created_at, expires_at, responded_at";

interface ProfileDbRow { id: string; username: string; avatar: string | null; last_seen_at: string | null; public_tag?: string | null }
/** Proyección FIJA: añadir una columna aquí es una decisión de privacidad, no un detalle. 0068 · el TAG es público. */
const PROFILE_COLS = "id, username, avatar, last_seen_at, public_tag";

interface MatchDbRow {
  id: string; mode: string; user_id: string; player_b_id: string | null; status: string; winner: "A" | "B" | null;
  closed_reason: string | null; closed_by: string | null; created_at: string; updated_at: string;
  scoreA?: number | null; scoreB?: number | null;
}
const MATCH_COLS = "id, mode, user_id, player_b_id, status, winner, closed_reason, closed_by, created_at, updated_at, scoreA:state->scoreA, scoreB:state->scoreB";

interface RatingDbRow { user_id: string; rating: number; games_played: number; wins: number; losses: number; draws: number; updated_at: string }
const PLACEMENT = 10;

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) || 0 : 0);
const msOrNull = (iso: string | null | undefined): number | null => (iso ? Date.parse(iso) || null : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toFriendship = (r: FriendshipDbRow): FriendshipRow => ({
  userLo: r.user_lo, userHi: r.user_hi, requesterId: r.requester_id,
  status: (["PENDING", "ACCEPTED", "DECLINED", "BLOCKED"].includes(r.status) ? r.status : "DECLINED") as FriendshipRow["status"],
  blockedBy: r.blocked_by, createdAt: ms(r.created_at), respondedAt: msOrNull(r.responded_at),
});

const toChallenge = (r: ChallengeDbRow): ChallengeRow => ({
  id: r.id, challengerId: r.challenger_id, challengedId: r.challenged_id,
  status: (["PENDING", "ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED", "MATCHED"].includes(r.status) ? r.status : "CANCELLED") as ChallengeStatus,
  matchId: r.match_id, previousMatchId: r.previous_match_id,
  createdAt: ms(r.created_at), expiresAt: ms(r.expires_at), respondedAt: msOrNull(r.responded_at),
});

const factsOf = (r: MatchDbRow): MatchFacts & { mode: "PVP" | "PVP_PRIVATE" | "PVE" } => ({
  status: r.status, winner: r.winner,
  closedReason: r.closed_reason === "ABANDONED" || r.closed_reason === "EXPIRED" ? r.closed_reason : null,
  closedBy: r.closed_by, playerAId: r.user_id, playerBId: r.player_b_id ?? "",
  mode: r.mode === "PVP" || r.mode === "PVP_PRIVATE" ? r.mode : "PVE",
});

const otherOf = (f: FriendshipRow, me: string): string => (f.userLo === me ? f.userHi : f.userLo);

/* ───────────────────────────── lecturas básicas ───────────────────────────── */

/** Perfiles públicos + último latido (este NUNCA sale del servidor). Los ids que no existen salen como «Jugador». */
async function profilesOf(sb: SupabaseClient, ids: string[]): Promise<Map<string, SocialPlayer & { lastSeenAt: number | null; tag?: string | null }>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, SocialPlayer & { lastSeenAt: number | null; tag?: string | null }>();
  if (unique.length === 0) return out;
  const { data, error } = await sb.from("profiles").select(PROFILE_COLS).in("id", unique);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as ProfileDbRow[]) {
    out.set(r.id, { userId: r.id, username: r.username, avatar: r.avatar ?? "🎮", lastSeenAt: msOrNull(r.last_seen_at), tag: r.public_tag ?? null });
  }
  for (const id of unique) if (!out.has(id)) out.set(id, { userId: id, username: "Jugador", avatar: "🎮", lastSeenAt: null });
  return out;
}

const publicOf = (p: SocialPlayer & { lastSeenAt?: number | null }): SocialPlayer => ({ userId: p.userId, username: p.username, avatar: p.avatar });

async function ratingsOf(sb: SupabaseClient, ids: string[]): Promise<Map<string, RatingSummary>> {
  const out = new Map<string, RatingSummary>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;
  const { data } = await sb.from("duel_pvp_ratings").select("user_id, rating, games_played").in("user_id", unique);
  for (const r of (data ?? []) as Pick<RatingDbRow, "user_id" | "rating" | "games_played">[]) {
    out.set(r.user_id, { rating: r.rating, gamesPlayed: r.games_played, provisional: r.games_played < PLACEMENT });
  }
  return out;
}

/** F85 · equipo favorito F89 público en lote (sin 0063 o con id inválido → ninguno). Logos solo los que ya existen. */
async function teamsOf(sb: SupabaseClient, ids: string[]): Promise<Map<string, SocialBadges["team"]>> {
  const out = new Map<string, SocialBadges["team"]>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;
  const { data, error } = await sb.from("player_profile_customization").select("user_id, favorite_team_id").in("user_id", unique);
  if (error) return out;
  for (const r of (data ?? []) as { user_id: string; favorite_team_id: string | null }[]) {
    const t = r.favorite_team_id ? teamFact(r.favorite_team_id) : null;
    if (t) out.set(r.user_id, { id: t.id, name: t.name, tag: t.tag, logo: t.logo });
  }
  return out;
}

/** F85 · rango + equipo de N jugadores: 4 lecturas en total, nunca una por jugador. */
async function badgesOf(sb: SupabaseClient, ids: string[]): Promise<Map<string, SocialBadges>> {
  const [ranks, teams] = await Promise.all([rankBadgesOf(sb, ids).catch(() => new Map<string, RankBadge>()), teamsOf(sb, ids)]);
  const out = new Map<string, SocialBadges>();
  for (const id of new Set(ids)) out.set(id, { rank: ranks.get(id) ?? null, team: teams.get(id) ?? null });
  return out;
}
const noBadges: SocialBadges = { rank: null, team: null };

async function friendshipsOf(sb: SupabaseClient, userId: string): Promise<FriendshipRow[]> {
  const { data, error } = await sb.from("duel_friendships").select(FRIENDSHIP_COLS)
    .or(`user_lo.eq.${userId},user_hi.eq.${userId}`).order("created_at", { ascending: false }).limit(FRIENDS_LIMIT + 60);
  if (error) throw new Error(error.message);
  return ((data ?? []) as FriendshipDbRow[]).map(toFriendship).filter((f) => f.status !== "BLOCKED");
}

async function friendshipBetween(sb: SupabaseClient, a: string, b: string): Promise<FriendshipRow | null> {
  const lo = a < b ? a : b, hi = a < b ? b : a;
  const { data, error } = await sb.from("duel_friendships").select(FRIENDSHIP_COLS).eq("user_lo", lo).eq("user_hi", hi).maybeSingle();
  if (error) throw new Error(error.message);
  const f = data ? toFriendship(data as FriendshipDbRow) : null;
  return f && f.status !== "BLOCKED" ? f : null;
}

/** F85 · mis bloqueos en los dos sentidos (solo servidor: el bloqueado nunca ve quién). */
interface Blocks { byMe: Set<string>; byThem: Set<string> }
async function blocksOf(sb: SupabaseClient, userId: string): Promise<Blocks> {
  const { data, error } = await sb.from("social_blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`).limit(2000);
  const out: Blocks = { byMe: new Set(), byThem: new Set() };
  if (error) {
    // Sin 0066 la tabla no existe: no hay bloqueos que aplicar (las RPC de 0048 seguirían decidiendo).
    if (/does not exist|could not find|PGRST205/i.test(error.message)) return out;
    throw new Error(error.message);
  }
  for (const r of (data ?? []) as { blocker_id: string; blocked_id: string }[]) {
    if (r.blocker_id === userId) out.byMe.add(r.blocked_id); else out.byThem.add(r.blocker_id);
  }
  return out;
}
const blockFacts = (b: Blocks, other: string): BlockFacts => ({ byMe: b.byMe.has(other), byThem: b.byThem.has(other) });

/**
 * F85 · PRESENCIA DE SERVIDOR en lote para N jugadores: partida PvP/privada VIVA (ciclo de vida canónico) y cola ranked
 * VIVA (F76). Dos lecturas acotadas; el cliente no puede afirmar «estoy en partida».
 */
async function liveOf(sb: SupabaseClient, ids: string[]): Promise<{ inMatch: Set<string>; inQueue: Set<string> }> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = { inMatch: new Set<string>(), inQueue: new Set<string>() };
  if (unique.length === 0) return out;
  const list = unique.join(",");
  const [m, q] = await Promise.all([
    sb.from("duel_matches").select("user_id, player_b_id").in("mode", ["PVP", "PVP_PRIVATE"]).in("status", ["WAITING", "IN_PROGRESS"])
      .is("closed_reason", null).or(`user_id.in.(${list}),player_b_id.in.(${list})`).limit(500),
    sb.from("duel_pvp_queue").select("user_id, expires_at").in("state", ["QUEUED", "PAIRING"]).in("user_id", unique).limit(500),
  ]);
  for (const r of (m.data ?? []) as { user_id: string; player_b_id: string | null }[]) { out.inMatch.add(r.user_id); if (r.player_b_id) out.inMatch.add(r.player_b_id); }
  const now = Date.now();
  for (const r of (q.data ?? []) as { user_id: string; expires_at: string }[]) if (ms(r.expires_at) > now) out.inQueue.add(r.user_id);
  return out;
}

/** Caduca en BD lo vencido del usuario (perezoso, por reloj de la BD) y lee sus retos. */
async function challengesOf(sb: SupabaseClient, userId: string, limit = 40, expire = true): Promise<ChallengeRow[]> {
  if (expire) await sb.rpc("social_challenge_expire_due", { p_user: userId });
  const { data, error } = await sb.from("duel_challenges").select(CHALLENGE_COLS)
    .or(`challenger_id.eq.${userId},challenged_id.eq.${userId}`)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ChallengeDbRow[]).map(toChallenge);
}

/**
 * F86 · Las partidas de TORNEO son técnicamente `PVP_PRIVATE` (mismo motor, sin rating), pero NO son duelos entre
 * amigos: no cuentan en el cara a cara, ni en rivales recientes, ni en «duelos privados recientes». Se reconocen por
 * `cup_matches.game_match_id` (una lectura acotada). Sin 0069 la tabla no existe y no hay nada que quitar.
 */
async function withoutCupGames(sb: SupabaseClient, rows: MatchDbRow[]): Promise<MatchDbRow[]> {
  const ids = [...new Set(rows.filter((r) => r.mode === "PVP_PRIVATE").map((r) => r.id))];
  if (!ids.length) return rows;
  const { data, error } = await sb.from("cup_matches").select("game_match_id").in("game_match_id", ids);
  if (error) return rows;
  const cup = new Set(((data ?? []) as { game_match_id: string | null }[]).map((r) => r.game_match_id));
  return cup.size ? rows.filter((r) => !cup.has(r.id)) : rows;
}

/** Partidas TERMINADAS de dos personas (ranked y privadas, sin las de torneo) donde participo. */
async function finishedMatchesOf(sb: SupabaseClient, userId: string, limit: number): Promise<MatchDbRow[]> {
  const { data, error } = await sb.from("duel_matches").select(MATCH_COLS)
    .in("mode", ["PVP", "PVP_PRIVATE"])
    .or(`user_id.eq.${userId},player_b_id.eq.${userId}`)
    .or("status.in.(COMPLETED,DRAW,UNRESOLVED),closed_reason.not.is.null")
    .order("updated_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return withoutCupGames(sb, (data ?? []) as MatchDbRow[]);
}

async function matchesBetween(sb: SupabaseClient, a: string, b: string, limit = 100): Promise<MatchDbRow[]> {
  const { data, error } = await sb.from("duel_matches").select(MATCH_COLS)
    .in("mode", ["PVP", "PVP_PRIVATE"])
    .or(`and(user_id.eq.${a},player_b_id.eq.${b}),and(user_id.eq.${b},player_b_id.eq.${a})`)
    .or("status.in.(COMPLETED,DRAW,UNRESOLVED),closed_reason.not.is.null")
    .order("updated_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return withoutCupGames(sb, (data ?? []) as MatchDbRow[]);
}

/** F85 · de unos ids de partida, cuáles siguen VIVAS (una lectura acotada). */
async function liveMatchIdsOf(sb: SupabaseClient, ids: (string | null)[]): Promise<Set<string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Set<string>();
  if (unique.length === 0) return out;
  const { data } = await sb.from("duel_matches").select("id").in("id", unique).in("status", ["WAITING", "IN_PROGRESS"]).is("closed_reason", null);
  for (const r of (data ?? []) as { id: string }[]) out.add(r.id);
  return out;
}

function challengeView(c: ChallengeRow, me: string, now: number, players: Map<string, SocialPlayer & { lastSeenAt?: number | null }>, ranks?: Map<string, SocialBadges>, live?: Set<string>): ChallengeView | null {
  const direction = directionOf(c, me);
  if (!direction) return null;
  const who = (id: string): SocialPlayer => publicOf(players.get(id) ?? { userId: id, username: "Jugador", avatar: "🎮" });
  const rivalId = direction === "INCOMING" ? c.challengerId : c.challengedId;
  return {
    id: c.id, status: effectiveStatus(c, now), direction,
    challenger: who(c.challengerId), challenged: who(c.challengedId),
    matchId: c.matchId, previousMatchId: c.previousMatchId,
    createdAt: c.createdAt, expiresAt: c.expiresAt, respondedAt: c.respondedAt,
    actions: { ...challengeActions(c, me, now), open: challengeActions(c, me, now).open && (live ? !!c.matchId && live.has(c.matchId) : true) },
    rivalRank: ranks?.get(rivalId)?.rank ?? null,
    matchLive: live ? !!c.matchId && live.has(c.matchId) : undefined,
  };
}

/** Huella corta y estable del estado social (para que otras pestañas sepan si releer). */
function versionOf(parts: string[]): string {
  let h = 2166136261;
  for (const ch of parts.join("|")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/* ───────────────────────────── snapshot ───────────────────────────── */

export async function getSocialSnapshot(sb: SupabaseClient, userId: string, opts: { now?: number } = {}): Promise<SocialResult<SocialSnapshot>> {
  const now = opts.now ?? Date.now();
  try {
    const [friendships, challenges, matches, blocks] = await Promise.all([
      friendshipsOf(sb, userId), challengesOf(sb, userId), finishedMatchesOf(sb, userId, 30), blocksOf(sb, userId),
    ]);

    const accepted = friendships.filter((f) => f.status === "ACCEPTED");
    const incomingF = friendships.filter((f) => f.status === "PENDING" && f.requesterId !== userId);
    const outgoingF = friendships.filter((f) => f.status === "PENDING" && f.requesterId === userId);

    const recent = recentOpponents(matches.map((m) => ({ at: ms(m.updated_at) || ms(m.created_at), rivalId: m.user_id === userId ? m.player_b_id ?? "" : m.user_id })), 12)
      .filter((r) => !blocks.byThem.has(r.rivalId)).slice(0, 8);

    const friendIds = accepted.map((f) => otherOf(f, userId));
    const ids = [
      userId, ...friendships.map((f) => otherOf(f, userId)), ...blocks.byMe,
      ...challenges.flatMap((c) => [c.challengerId, c.challengedId]), ...recent.map((r) => r.rivalId),
    ];
    const badgeIds = [...friendships.map((f) => otherOf(f, userId)), ...recent.map((r) => r.rivalId), ...challenges.flatMap((c) => [c.challengerId, c.challengedId])];
    const [players, ratings, badges, live, liveMatches] = await Promise.all([
      profilesOf(sb, ids), ratingsOf(sb, friendIds), badgesOf(sb, badgeIds), liveOf(sb, friendIds), liveMatchIdsOf(sb, challenges.map((c) => c.matchId)),
    ]);
    const me = players.get(userId) ?? { userId, username: "Jugador", avatar: "🎮", lastSeenAt: null };
    const presence = (id: string) => presenceOf(players.get(id)?.lastSeenAt ?? null, now, { inMatch: live.inMatch.has(id), inQueue: live.inQueue.has(id) });

    const friendsAll: FriendView[] = sortFriends(accepted.map((f) => {
      const id = otherOf(f, userId);
      const p = players.get(id)!;
      return { ...publicOf(p), ...(badges.get(id) ?? noBadges), presence: presence(id), lastSeenAt: null, since: f.respondedAt ?? f.createdAt, rating: ratings.get(id) ?? null };
    }));

    const req = (f: FriendshipRow): RequestView => { const id = otherOf(f, userId); return { player: publicOf(players.get(id)!), at: f.createdAt, ...(badges.get(id) ?? noBadges) }; };
    const incoming = incomingF.map(req);
    const outgoing = outgoingF.map(req);
    const blocked = [...blocks.byMe].map((id) => publicOf(players.get(id) ?? { userId: id, username: "Jugador", avatar: "🎮" }));

    const challengeViews = challenges.map((c) => challengeView(c, userId, now, players, badges, liveMatches)).filter((c): c is ChallengeView => c !== null);
    const byPair = new Map<string, FriendshipRow>();
    for (const f of friendships) byPair.set(otherOf(f, userId), f);
    const friendSet = new Set(friendIds);

    const recentOpp: RecentOpponentView[] = recent.map((r) => {
      const p = players.get(r.rivalId)!;
      return {
        ...publicOf(p), ...(badges.get(r.rivalId) ?? noBadges), lastAt: r.lastAt, games: r.games,
        relation: relationFor(byPair.get(r.rivalId) ?? null, userId, r.rivalId, blockFacts(blocks, r.rivalId)),
        presence: friendSet.has(r.rivalId) ? presence(r.rivalId) : null,
      };
    });

    const inboxAll = inboxOf({
      incomingRequests: incoming.map((r) => ({ ...r.player, at: r.at })),
      challenges: challenges.map((c) => ({
        ...c,
        challenger: publicOf(players.get(c.challengerId) ?? { userId: c.challengerId, username: "Jugador", avatar: "🎮" }),
        challenged: publicOf(players.get(c.challengedId) ?? { userId: c.challengedId, username: "Jugador", avatar: "🎮" }),
      })),
      me: userId, now,
    });
    // F85 · «tu reto fue aceptado · entrar» solo mientras la partida siga viva.
    const inbox = inboxAll.filter((i) => i.kind !== "CHALLENGE_ACCEPTED" || (!!i.matchId && liveMatches.has(i.matchId)));

    const activity = activityOf({
      friendships: accepted.map((f) => ({ username: players.get(otherOf(f, userId))!.username, respondedAt: f.respondedAt, status: f.status })),
      matches: matches.slice(0, 12).map((m) => {
        const f = factsOf(m);
        const rivalId = m.user_id === userId ? m.player_b_id ?? "" : m.user_id;
        return { id: m.id, at: ms(m.updated_at) || ms(m.created_at), rivalName: players.get(rivalId)?.username ?? "Jugador", mode: f.mode, letter: letterOf(outcomeFor(f, userId)) };
      }),
      max: 8,
    });

    const pendingIn = challengeViews.filter((c) => c.status === "PENDING" && c.direction === "INCOMING").length;
    const pendingOut = challengeViews.filter((c) => c.status === "PENDING" && c.direction === "OUTGOING").length;

    return done({
      self: publicOf(me),
      selfTag: ("tag" in me ? me.tag : null) ?? null,
      counts: { friends: friendsAll.length, incoming: incoming.length, outgoing: outgoing.length, challengesIn: pendingIn, challengesOut: pendingOut, blocked: blocked.length },
      friends: friendsAll.slice(0, FRIENDS_PAGE), friendsLimit: FRIENDS_LIMIT,
      incoming, outgoing, blocked,
      challenges: challengeViews,
      recentOpponents: recentOpp,
      inbox, badge: badgeCount(inbox), activity,
      serverNow: now, presenceWindows: { ...PRESENCE_WINDOWS }, challengeTtlSeconds: CHALLENGE_TTL_SECONDS,
      version: socialVersion(friendships, challenges, blocks, now),
    });
  } catch (e) {
    logSocial("snapshot", "ERROR", e instanceof Error ? e.message : "");
    return fail(500, e instanceof Error ? e.message : "No se pudo leer lo social");
  }
}

function socialVersion(friendships: FriendshipRow[], challenges: ChallengeRow[], blocks: Blocks, now: number): string {
  return versionOf([
    ...friendships.map((f) => `${f.userLo}${f.userHi}${f.status}${f.requesterId}`).sort(),
    ...challenges.map((c) => `${c.id}${effectiveStatus(c, now)}`).sort(),
    `b${blocks.byMe.size}`,
  ]);
}

/** F85 · página de amigos (≤ 100, mismo orden que la foto). */
export async function getFriendsPage(sb: SupabaseClient, userId: string, rawOffset: unknown, opts: { now?: number } = {}): Promise<SocialResult<{ friends: FriendView[]; offset: number; total: number; hasMore: boolean }>> {
  const now = opts.now ?? Date.now();
  const offset = Math.max(0, Math.min(FRIENDS_LIMIT, Math.floor(Number(rawOffset) || 0)));
  try {
    const accepted = (await friendshipsOf(sb, userId)).filter((f) => f.status === "ACCEPTED");
    const ids = accepted.map((f) => otherOf(f, userId));
    const [players, live] = await Promise.all([profilesOf(sb, ids), liveOf(sb, ids)]);
    const sorted = sortFriends(accepted.map((f) => {
      const id = otherOf(f, userId);
      const p = players.get(id)!;
      return { f, id, username: p.username, presence: presenceOf(p.lastSeenAt, now, { inMatch: live.inMatch.has(id), inQueue: live.inQueue.has(id) }) };
    }));
    const page = sorted.slice(offset, offset + FRIENDS_PAGE);
    const pids = page.map((x) => x.id);
    const [ratings, badges] = await Promise.all([ratingsOf(sb, pids), badgesOf(sb, pids)]);
    return done({
      friends: page.map((x) => ({ ...publicOf(players.get(x.id)!), ...(badges.get(x.id) ?? noBadges), presence: x.presence, lastSeenAt: null, since: x.f.respondedAt ?? x.f.createdAt, rating: ratings.get(x.id) ?? null })),
      offset, total: sorted.length, hasMore: offset + FRIENDS_PAGE < sorted.length,
    });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer tus amigos");
  }
}

/* ───────────────────────────── pulso (latido + contador + retos en curso) ───────────────────────────── */

export interface SocialPulse {
  /** Solicitudes recibidas + retos recibidos pendientes (lo que espera MI acción). */
  badge: number;
  /** Huella barata: si cambia, el hub y las demás pestañas releen la foto. */
  version: string;
  /** El reto recibido PENDIENTE más reciente (para el aviso global). */
  incoming: ChallengeView | null;
  /** Mi último reto enviado en los últimos 10 min y su estado efectivo (esperando / aceptado / rechazado / caducado). */
  outgoing: ChallengeView | null;
  /** Partida PvP/privada VIVA en la que participo (para no avisar de retos en mitad de una partida y para reconectar). */
  activeMatchId: string | null;
  serverNow: number;
}

/**
 * F85 · UN pulso cada 20 s por pestaña visible (y al volver a ella): actualiza MI `last_seen_at` (solo si el anterior
 * tiene ≥ 40 s: varias pestañas no multiplican escrituras) y devuelve el contador y los retos en curso. Lecturas acotadas;
 * no caduca retos (eso lo hacen las lecturas completas y la RPC al aceptar, con la hora de la BD).
 */
export async function socialPulse(sb: SupabaseClient, userId: string, opts: { now?: number } = {}): Promise<SocialResult<SocialPulse>> {
  const now = opts.now ?? Date.now();
  try {
    await sb.from("profiles").update({ last_seen_at: new Date(now).toISOString() }).eq("id", userId)
      .or(`last_seen_at.is.null,last_seen_at.lt.${new Date(now - HEARTBEAT_WRITE_MIN_MS).toISOString()}`);
    const [reqs, challenges, live, blocks] = await Promise.all([
      sb.from("duel_friendships").select("user_lo, user_hi, requester_id, status", { count: "exact" })
        .or(`user_lo.eq.${userId},user_hi.eq.${userId}`).in("status", ["PENDING", "ACCEPTED"]).limit(FRIENDS_LIMIT + 60),
      challengesOf(sb, userId, 20, false),
      sb.from("duel_matches").select("id").in("mode", ["PVP", "PVP_PRIVATE"]).in("status", ["WAITING", "IN_PROGRESS"]).is("closed_reason", null)
        .or(`user_id.eq.${userId},player_b_id.eq.${userId}`).order("updated_at", { ascending: false }).limit(1),
      blocksOf(sb, userId),
    ]);
    if (reqs.error) throw new Error(reqs.error.message);
    const rows = (reqs.data ?? []) as { user_lo: string; user_hi: string; requester_id: string; status: string }[];
    const incomingReqs = rows.filter((r) => r.status === "PENDING" && r.requester_id !== userId).length;
    const pendingIn = challenges.filter((c) => effectiveStatus(c, now) === "PENDING" && c.challengedId === userId);
    const lastOut = challenges.find((c) => c.challengerId === userId && now - c.createdAt < 10 * 60_000) ?? null;
    const ids = [...new Set([...pendingIn.slice(0, 1).map((c) => c.challengerId), ...(lastOut ? [lastOut.challengedId] : []), userId])];
    const [players, badges] = await Promise.all([profilesOf(sb, ids), badgesOf(sb, ids.filter((i) => i !== userId))]);
    const activeMatchId = ((live.data ?? []) as { id: string }[])[0]?.id ?? null;
    return done({
      badge: incomingReqs + pendingIn.length,
      version: versionOf([
        ...rows.map((r) => `${r.user_lo}${r.user_hi}${r.status}${r.requester_id}`).sort(),
        ...challenges.map((c) => `${c.id}${effectiveStatus(c, now)}`).sort(),
        `b${blocks.byMe.size}`,
      ]),
      incoming: pendingIn[0] ? challengeView(pendingIn[0], userId, now, players, badges) : null,
      outgoing: lastOut ? challengeView(lastOut, userId, now, players, badges) : null,
      activeMatchId, serverNow: now,
    });
  } catch (e) {
    logSocial("pulse", "ERROR", e instanceof Error ? e.message : "");
    return fail(500, e instanceof Error ? e.message : "No se pudo leer el pulso social");
  }
}

/** Solo el número de la navegación (compatibilidad F29): ahora sale del pulso sin escribir el latido. */
export async function getSocialBadge(sb: SupabaseClient, userId: string, opts: { now?: number } = {}): Promise<SocialResult<{ badge: number; activeMatchId: string | null }>> {
  const now = opts.now ?? Date.now();
  try {
    const [{ count: reqs, error: e1 }, challenges, live] = await Promise.all([
      sb.from("duel_friendships").select("user_lo", { count: "exact", head: true })
        .or(`user_lo.eq.${userId},user_hi.eq.${userId}`).eq("status", "PENDING").neq("requester_id", userId),
      challengesOf(sb, userId, 20, false),
      // F85 · solo una partida VIVA (antes: cualquier reto MATCHED, aunque la partida hubiera terminado hace días).
      sb.from("duel_matches").select("id").in("mode", ["PVP", "PVP_PRIVATE"]).in("status", ["WAITING", "IN_PROGRESS"]).is("closed_reason", null)
        .or(`user_id.eq.${userId},player_b_id.eq.${userId}`).limit(1),
    ]);
    if (e1) throw new Error(e1.message);
    const pending = challenges.filter((c) => effectiveStatus(c, now) === "PENDING" && c.challengedId === userId).length;
    return done({ badge: (reqs ?? 0) + pending, activeMatchId: ((live.data ?? []) as { id: string }[])[0]?.id ?? null });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer el contador");
  }
}

/* ───────────────────────────── búsqueda ───────────────────────────── */

/**
 * Búsqueda ACOTADA por prefijo de `username` (≥ 2 caracteres, 10 por página, ≤ 5 páginas, sin comodines del cliente).
 * No devuelve correo ni acepta «@». Excluye a quien busca, a quien lo tiene bloqueado y a cuentas sancionadas (ban o
 * suspensión vigente: no aparecen públicamente). La presencia solo viaja de amigos.
 */
export async function searchPlayers(sb: SupabaseClient, userId: string, rawQuery: unknown, opts: { now?: number; offset?: unknown } = {}): Promise<SocialResult<SocialSearchResult>> {
  // 0068 · «#TAG» = búsqueda EXACTA por tag público (mayúsculas/minúsculas da igual; nunca difusa, nunca por prefijo).
  const byTag = looksLikeTagQuery(rawQuery);
  const tag = byTag ? normalizeTag(rawQuery) : null;
  if (byTag && tag === null) return fail(400, "Ese tag no es válido: son 7 caracteres, por ejemplo #7K4M92X", "BAD_TAG");
  const q = byTag ? `#${tag}` : normalizeQuery(rawQuery);
  if (q === null) return fail(400, "Escribe al menos 2 caracteres del nombre de usuario o un #TAG", "QUERY_TOO_SHORT");
  const now = opts.now ?? Date.now();
  const offset = byTag ? 0 : Math.max(0, Math.min(SEARCH_MAX_OFFSET, Math.floor(Number(opts.offset) || 0)));
  try {
    const { data, error } = byTag
      ? await sb.from("profiles").select(PROFILE_COLS).eq("public_tag", tag as string).neq("id", userId).limit(1)
      : await sb.from("profiles").select(PROFILE_COLS)
        .ilike("username", likePrefix(q)).neq("id", userId).order("username", { ascending: true }).range(offset, offset + SEARCH_LIMIT);
    if (error) throw new Error(error.message);
    let all = (data ?? []) as ProfileDbRow[];
    // F86.2 · un tag pegado SIN «#» («7K4M92X») también encuentra a su dueño: coincidencia EXACTA, delante de los
    // nombres (nunca difusa). Solo en la primera página y solo si el texto tiene la forma exacta de un tag.
    const bare = !byTag && offset === 0 ? normalizeTag(rawQuery) : null;
    if (bare) {
      const { data: hit, error: tagErr } = await sb.from("profiles").select(PROFILE_COLS).eq("public_tag", bare).neq("id", userId).limit(1);
      if (tagErr) throw new Error(tagErr.message);
      const t = ((hit ?? []) as ProfileDbRow[])[0];
      if (t) all = [t, ...all.filter((r) => r.id !== t.id)];
    }
    const hasMore = !byTag && all.length > SEARCH_LIMIT && offset + SEARCH_LIMIT <= SEARCH_MAX_OFFSET;
    const rows = all.slice(0, SEARCH_LIMIT);
    const ids = rows.map((r) => r.id);
    const [friendships, ratings, blocks, sanctioned, badges, live] = await Promise.all([
      friendshipsOf(sb, userId), ratingsOf(sb, ids), blocksOf(sb, userId), sanctionedOf(sb, ids, now), badgesOf(sb, ids), liveOf(sb, ids),
    ]);
    const byPair = new Map<string, FriendshipRow>();
    for (const f of friendships) byPair.set(otherOf(f, userId), f);
    const players: SearchHit[] = [];
    for (const r of rows) {
      if (sanctioned.has(r.id)) continue;
      const relation = relationFor(byPair.get(r.id) ?? null, userId, r.id, blockFacts(blocks, r.id));
      if (relation === "BLOCKED_ME") continue; // quien me bloqueó no aparece para mí: no hay «existe pero no»
      players.push({
        userId: r.id, username: r.username, avatar: r.avatar ?? "🎮", ...(badges.get(r.id) ?? noBadges), relation,
        presence: relation === "FRIENDS" ? presenceOf(msOrNull(r.last_seen_at), now, { inMatch: live.inMatch.has(r.id), inQueue: live.inQueue.has(r.id) }) : null,
        rating: ratings.get(r.id) ?? null,
        tag: normalizeTag(r.public_tag ?? null),
      });
    }
    return done({ query: q, players, limit: SEARCH_LIMIT, offset, hasMore });
  } catch (e) {
    logSocial("search", "ERROR", e instanceof Error ? e.message : "");
    return fail(500, e instanceof Error ? e.message : "No se pudo buscar");
  }
}

/** Cuentas con ban o suspensión vigente (no aparecen en búsqueda). Sin la tabla, ninguna. */
async function sanctionedOf(sb: SupabaseClient, ids: string[], now: number): Promise<Set<string>> {
  const out = new Set<string>();
  if (ids.length === 0) return out;
  const { data, error } = await sb.from("user_sanctions").select("user_id, type, expires_at").in("user_id", ids).is("revoked_at", null);
  if (error) return out;
  for (const r of (data ?? []) as { user_id: string; type: string; expires_at: string | null }[]) {
    if (r.type === "ban" || (r.expires_at !== null && ms(r.expires_at) > now)) out.add(r.user_id);
  }
  return out;
}

/* ───────────────────────────── perfil social de un jugador ───────────────────────────── */

export async function getSocialPlayer(sb: SupabaseClient, viewerId: string, playerId: string, opts: { now?: number } = {}): Promise<SocialResult<SocialPlayerView>> {
  if (!UUID.test(playerId)) return fail(400, "Jugador no válido");
  const now = opts.now ?? Date.now();
  try {
    const { data: prow, error: perr } = await sb.from("profiles").select(PROFILE_COLS).eq("id", playerId).maybeSingle();
    if (perr) throw new Error(perr.message);
    const p = prow as ProfileDbRow | null;
    if (!p) return fail(404, "Jugador no encontrado");
    const self = viewerId === playerId;

    const [friendship, between, challenges, rrow, blocks, badges, live] = await Promise.all([
      self ? Promise.resolve(null) : friendshipBetween(sb, viewerId, playerId),
      self ? Promise.resolve([] as MatchDbRow[]) : matchesBetween(sb, viewerId, playerId),
      self ? Promise.resolve([] as ChallengeRow[]) : challengesOf(sb, viewerId, 40),
      sb.from("duel_pvp_ratings").select("user_id, rating, games_played, wins, losses, draws, updated_at").eq("user_id", playerId).maybeSingle(),
      self ? Promise.resolve<Blocks>({ byMe: new Set(), byThem: new Set() }) : blocksOf(sb, viewerId),
      badgesOf(sb, [playerId]),
      liveOf(sb, [playerId]),
    ]);
    const relation = relationFor(friendship, viewerId, playerId, blockFacts(blocks, playerId));
    // Quien me bloqueó no existe PARA LO SOCIAL: mismo 404 que un id inventado (su perfil público F89 sigue siendo público).
    if (relation === "BLOCKED_ME") return fail(404, "Jugador no encontrado");

    const r = rrow.data as RatingDbRow | null;
    const rating: DuelRating | null = r ? { rating: r.rating, gamesPlayed: r.games_played, wins: r.wins, losses: r.losses, draws: r.draws, provisional: r.games_played < PLACEMENT, updatedAt: ms(r.updated_at) } : null;

    const facts = between.map(factsOf);
    const pending = challenges.find((c) => effectiveStatus(c, now) === "PENDING" && (c.challengerId === playerId || c.challengedId === playerId));
    const players = new Map<string, SocialPlayer>([[playerId, { userId: p.id, username: p.username, avatar: p.avatar ?? "🎮" }]]);
    if (pending) {
      const me = await profilesOf(sb, [viewerId]);
      for (const [k, v] of me) players.set(k, publicOf(v));
    }
    const recentPrivate = between.filter((m) => m.mode === "PVP_PRIVATE").slice(0, 5).map((m) => {
      const f = factsOf(m);
      const side = sideOf(f, viewerId);
      const sa = Number(m.scoreA ?? 0), sb2 = Number(m.scoreB ?? 0);
      return { matchId: m.id, at: ms(m.updated_at) || ms(m.created_at), letter: letterOf(outcomeFor(f, viewerId)), scoreYou: side === "B" ? sb2 : sa, scoreRival: side === "B" ? sa : sb2 };
    });

    return done({
      player: { userId: p.id, username: p.username, avatar: p.avatar ?? "🎮" },
      relation, actions: actionsFor(relation),
      // F85 · presencia SOLO para amigos (o uno mismo); nunca la hora exacta.
      presence: relation === "FRIENDS" || relation === "SELF"
        ? presenceOf(msOrNull(p.last_seen_at), now, { inMatch: live.inMatch.has(playerId), inQueue: live.inQueue.has(playerId) }) : null,
      lastSeenAt: null,
      rating, rank: badges.get(playerId)?.rank ?? null,
      h2h: h2hSplit(facts, viewerId, playerId),
      pendingChallenge: pending ? challengeView(pending, viewerId, now, players) : null,
      recentPrivate,
      friendsSince: friendship?.status === "ACCEPTED" ? friendship.respondedAt ?? friendship.createdAt : null,
    });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer el jugador");
  }
}

/* ───────────────────────────── duelo privado: quién hay enfrente ───────────────────────────── */

export interface PrivateMatchInfo {
  matchId: string;
  mode: "PVP" | "PVP_PRIVATE";
  you: SocialPlayer;
  rival: SocialPlayer;
  relation: RelationState;
  /** Cara a cara ACTUAL (incluye esta partida si ya terminó). */
  h2h: H2HSplit;
  /** Quién cerró la partida (abandono o tiempo), como BANDO, nunca como id. `null` si se jugó entera. */
  closedBySide: "A" | "B" | null;
  yourSide: "A" | "B";
  /** Reto del que nació, si existe (para «otro reto» y la revancha). */
  challengeId: string | null;
  /** F86 · si es un cruce de TORNEO: a qué torneo y ronda pertenece (sin revancha: el resultado es el resultado). */
  cup: { slug: string; name: string; round: number; roundName: string;
    /** F86.1 · qué significó para MÍ este cruce, ya liquidado por el servidor (null mientras no hay resultado final). */
    outcome: "ADVANCED" | "ELIMINATED" | "CHAMPION" | "REVIEW" | null; nextRoundName: string | null } | null;
}

/**
 * La identidad del rival y el cara a cara para la arena/resultado de un duelo de dos personas.
 * SOLO sus dos participantes (404 al resto). No devuelve cartas, mazos ni estado de juego.
 */
export async function getPrivateMatchInfo(sb: SupabaseClient, viewerId: string, matchId: string): Promise<SocialResult<PrivateMatchInfo>> {
  if (!UUID.test(matchId)) return fail(400, "Partida no válida");
  try {
    const { data, error } = await sb.from("duel_matches").select("id, mode, user_id, player_b_id, closed_by").eq("id", matchId).maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as { id: string; mode: string; user_id: string; player_b_id: string | null; closed_by: string | null } | null;
    if (!row || (row.mode !== "PVP" && row.mode !== "PVP_PRIVATE")) return fail(404, "Partida no encontrada");
    if (viewerId !== row.user_id && viewerId !== row.player_b_id) return fail(404, "Partida no encontrada");
    const rivalId = viewerId === row.user_id ? row.player_b_id ?? "" : row.user_id;
    const [players, friendship, between, ch, blocks, cupRow] = await Promise.all([
      profilesOf(sb, [viewerId, rivalId]), friendshipBetween(sb, viewerId, rivalId), matchesBetween(sb, viewerId, rivalId),
      sb.from("duel_challenges").select("id").eq("match_id", matchId).maybeSingle(),
      blocksOf(sb, viewerId),
      row.mode === "PVP_PRIVATE"
        ? sb.from("cup_matches").select("round, cup_id, status, winner_id").eq("game_match_id", matchId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const cr = (cupRow.error ? null : cupRow.data) as { round: number; cup_id: string; status: string; winner_id: string | null } | null;
    const cupInfo = cr ? ((await sb.from("cups").select("slug, name, rounds").eq("id", cr.cup_id).maybeSingle()).data as { slug: string; name: string; rounds: number | null } | null) : null;
    const cm = cr && cupInfo ? { round: cr.round, cups: cupInfo } : null;
    return done({
      matchId: row.id, mode: row.mode,
      you: publicOf(players.get(viewerId)!), rival: publicOf(players.get(rivalId)!),
      relation: relationFor(friendship, viewerId, rivalId, blockFacts(blocks, rivalId)),
      h2h: h2hSplit(between.map(factsOf), viewerId, rivalId),
      closedBySide: row.closed_by === null ? null : row.closed_by === row.user_id ? "A" : "B",
      yourSide: viewerId === row.user_id ? "A" : "B",
      challengeId: (ch.data as { id: string } | null)?.id ?? null,
      cup: cm?.cups ? (() => {
        const rounds = cm.cups.rounds ?? cm.round;
        const outcome = cr!.status === "COMPLETED" ? (cr!.winner_id === viewerId ? (cm.round >= rounds ? "CHAMPION" : "ADVANCED") : "ELIMINATED")
          : cr!.status === "ACTION_REQUIRED" ? "REVIEW" : null;
        return { slug: cm.cups.slug, name: cm.cups.name, round: cm.round, roundName: roundName(cm.round, rounds), outcome,
          nextRoundName: outcome === "ADVANCED" ? roundName(cm.round + 1, rounds) : null } as const;
      })() : null,
    });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer la partida");
  }
}

/* ───────────────────────────── comparar (F85) ───────────────────────────── */

export interface CompareSide {
  player: SocialPlayer;
  rank: RankBadge | null;
  rating: number | null;
  /** Nivel de la ruta de temporada F83 si hay temporada activa (público en el perfil). */
  seasonLevel: number | null;
  /** Récord PÚBLICO (ranked + IA + draft; nunca duelos privados), como en el perfil público. */
  matches: number;
  winrate: number | null;
  uniqueCards: number;
  totalCards: number;
  collectionsCompleted: number;
  badges: number;
}
export interface SocialCompare { you: CompareSide; them: CompareSide; relation: RelationState }

/**
 * F85 · COMPARACIÓN LIGERA lado a lado con SOLO datos públicos del perfil F89 (la misma proyección PÚBLICA para los dos
 * lados, también para el propio: nada privado se cuela por comparar). Sin puntuación compuesta ni «quién es mejor».
 */
export async function getSocialCompare(sb: SupabaseClient, viewerId: string, playerId: string): Promise<SocialResult<SocialCompare>> {
  if (!UUID.test(playerId)) return fail(400, "Jugador no válido");
  if (playerId === viewerId) return fail(400, "Elige a otro jugador para comparar", "SELF");
  try {
    const [blocks, friendship] = await Promise.all([blocksOf(sb, viewerId), friendshipBetween(sb, viewerId, playerId)]);
    const relation = relationFor(friendship, viewerId, playerId, blockFacts(blocks, playerId));
    if (relation === "BLOCKED_ME") return fail(404, "Jugador no encontrado");
    const { getPlayerIdentity } = await import("./playerIdentity");
    // Los DOS lados con la proyección PÚBLICA (espectador = el otro jugador): lo mío no enseña más que lo suyo.
    const [mine, theirs] = await Promise.all([getPlayerIdentity(sb, viewerId, playerId), getPlayerIdentity(sb, playerId, viewerId)]);
    if (!mine.ok || !mine.data) return fail(mine.status === 404 ? 404 : 500, mine.error ?? "No se pudo comparar");
    if (!theirs.ok || !theirs.data) return fail(500, theirs.error ?? "No se pudo comparar");
    const side = (s: NonNullable<typeof mine.data>): CompareSide => ({
      player: { userId: s.player.userId, username: s.player.username, avatar: s.player.avatar },
      rank: s.competitive ? { state: s.competitive.state, label: s.competitive.rank?.label ?? (s.competitive.state === "PLACEMENT" ? `Colocación ${s.competitive.placement.played}/${s.competitive.placement.total}` : "Sin clasificar"), rank: s.competitive.rank } : null,
      rating: s.ranked?.rating ?? s.competitive?.rating ?? null,
      seasonLevel: s.seasonTrack?.level ?? null,
      matches: s.career?.stats.total.played ?? 0,
      winrate: s.career?.stats.total.winrate ?? null,
      uniqueCards: s.collection.distinct, totalCards: s.collection.totalCards,
      collectionsCompleted: s.collections?.completed.length ?? 0,
      badges: s.badges.length,
    });
    return done({ you: side(theirs.data), them: side(mine.data), relation });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo comparar");
  }
}

/* ───────────────────────────── presencia ───────────────────────────── */

/** Latido: SOLO el propio `last_seen_at` (compatibilidad F29; la app usa `socialPulse`). */
export async function heartbeat(sb: SupabaseClient, userId: string, opts: { now?: number } = {}): Promise<SocialResult<{ lastSeenAt: number }>> {
  const now = opts.now ?? Date.now();
  const { error } = await sb.from("profiles").update({ last_seen_at: new Date(now).toISOString() }).eq("id", userId)
    .or(`last_seen_at.is.null,last_seen_at.lt.${new Date(now - HEARTBEAT_WRITE_MIN_MS).toISOString()}`);
  if (error) { logSocial("heartbeat", "ERROR", error.message); return fail(500, error.message); }
  return done({ lastSeenAt: now });
}

/* ───────────────────────────── amistad (mutaciones vía RPC) ───────────────────────────── */

type Rpc = { code: string; [k: string]: unknown };

async function rpc(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Rpc> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  const out = data as Rpc | null;
  if (!out || typeof out.code !== "string") throw new Error(`Respuesta inesperada de ${fn}`);
  return out;
}

export interface RelationChange { relation: RelationState; code: string }

async function relationAfter(sb: SupabaseClient, me: string, other: string, code: string): Promise<SocialResult<RelationChange>> {
  const [row, blocks] = await Promise.all([friendshipBetween(sb, me, other), blocksOf(sb, me)]);
  return done({ relation: relationFor(row, me, other, blockFacts(blocks, other)), code });
}

const guardTarget = (me: string, target: unknown): SocialResult<never> | null => {
  if (typeof target !== "string" || !UUID.test(target)) return fail(400, "Jugador no válido", "BAD_TARGET");
  if (target === me) return fail(400, "No puedes hacer eso contigo", "SELF");
  return null;
};

/** Respuesta NEUTRA ante un bloqueo en cualquier sentido: no revela quién bloqueó. */
const UNAVAILABLE = (): SocialResult<never> => fail(409, "Acción no disponible", "UNAVAILABLE");

/** Enviar solicitud. Cruzadas → amigos directamente. Doble clic → una sola fila (REQUESTED/ALREADY_PENDING). */
export async function friendRequest(sb: SupabaseClient, me: string, target: string): Promise<SocialResult<RelationChange>> {
  const g = guardTarget(me, target); if (g) return g;
  try {
    const r = await rpc(sb, "social_friend_request", { p_user: me, p_target: target });
    switch (r.code) {
      case "NOT_FOUND": return fail(404, "Jugador no encontrado", r.code);
      case "UNAVAILABLE": case "BLOCKED": return UNAVAILABLE();
      case "SELF": return fail(400, "No puedes añadirte a ti", r.code);
      case "FRIEND_LIMIT": return fail(409, `Has llegado al máximo de ${FRIENDS_LIMIT} amigos (o lo ha hecho esa persona)`, r.code);
      case "PENDING_LIMIT": return fail(409, "Tienes demasiadas solicitudes sin responder: espera o retira alguna", r.code);
      default: return relationAfter(sb, me, target, r.code);
    }
  } catch (e) { logSocial("friend_request", "RPC", e instanceof Error ? e.message : ""); return fail(500, e instanceof Error ? e.message : "No se pudo enviar la solicitud", "RPC"); }
}

export async function respondFriend(sb: SupabaseClient, me: string, target: string, accept: boolean): Promise<SocialResult<RelationChange>> {
  const g = guardTarget(me, target); if (g) return g;
  try {
    const r = await rpc(sb, "social_friend_respond", { p_user: me, p_target: target, p_accept: accept });
    switch (r.code) {
      case "NO_REQUEST": return fail(409, "No hay ninguna solicitud pendiente", r.code);
      case "NOT_TARGET": return fail(409, "Esa solicitud la enviaste tú: solo puede aceptarla la otra persona", r.code);
      case "SELF": return fail(400, "No puedes aceptarte a ti", r.code);
      case "FRIEND_LIMIT": return fail(409, `Uno de los dos ha llegado al máximo de ${FRIENDS_LIMIT} amigos`, r.code);
      default: return relationAfter(sb, me, target, r.code);
    }
  } catch (e) { logSocial(accept ? "friend_accept" : "friend_decline", "RPC", e instanceof Error ? e.message : ""); return fail(500, e instanceof Error ? e.message : "No se pudo responder", "RPC"); }
}

export async function unfriend(sb: SupabaseClient, me: string, target: string): Promise<SocialResult<RelationChange>> {
  const g = guardTarget(me, target); if (g) return g;
  try {
    const r = await rpc(sb, "social_unfriend", { p_user: me, p_target: target });
    if (r.code === "NOT_FRIENDS") return fail(409, "No sois amigos", r.code);
    return relationAfter(sb, me, target, r.code);
  } catch (e) { logSocial("unfriend", "RPC", e instanceof Error ? e.message : ""); return fail(500, e instanceof Error ? e.message : "No se pudo eliminar", "RPC"); }
}

export async function blockPlayer(sb: SupabaseClient, me: string, target: string): Promise<SocialResult<RelationChange>> {
  const g = guardTarget(me, target); if (g) return g;
  try {
    const r = await rpc(sb, "social_block", { p_user: me, p_target: target });
    if (r.code === "NOT_FOUND") return fail(404, "Jugador no encontrado", r.code);
    return relationAfter(sb, me, target, r.code);
  } catch (e) { logSocial("block", "RPC", e instanceof Error ? e.message : ""); return fail(500, e instanceof Error ? e.message : "No se pudo bloquear", "RPC"); }
}

export async function unblockPlayer(sb: SupabaseClient, me: string, target: string): Promise<SocialResult<RelationChange>> {
  const g = guardTarget(me, target); if (g) return g;
  try {
    const r = await rpc(sb, "social_unblock", { p_user: me, p_target: target });
    if (r.code === "NOT_BLOCKED") return fail(409, "No tienes bloqueado a ese jugador", r.code);
    return relationAfter(sb, me, target, r.code);
  } catch (e) { logSocial("unblock", "RPC", e instanceof Error ? e.message : ""); return fail(500, e instanceof Error ? e.message : "No se pudo desbloquear", "RPC"); }
}

/* ───────────────────────────── retos y duelo amistoso ───────────────────────────── */

export interface ChallengeCreated { challengeId: string; expiresAt: number; code: "CREATED" | "ALREADY_PENDING" }

/**
 * Crear un reto (solo amigos, 5 min). El mazo del retador se valida AHORA (propiedad + legalidad, la misma función que
 * el ranked) y se vuelve a validar al crearse la partida. UN reto pendiente por pareja: el doble clic recibe el mismo
 * `challengeId`; si el amigo ya me había retado, se le dice al jugador que acepte el suyo.
 */
export async function createChallenge(
  sb: SupabaseClient, me: string, input: { targetUserId: string; deckId: string; previousMatchId?: string | null },
): Promise<SocialResult<ChallengeCreated>> {
  const g = guardTarget(me, input.targetUserId); if (g) return g;
  if (typeof input.deckId !== "string" || !UUID.test(input.deckId)) return fail(400, "Elige un mazo", "DECK_REQUIRED");
  const prev = input.previousMatchId ?? null;
  if (prev !== null && !UUID.test(prev)) return fail(400, "Partida anterior no válida", "BAD_PREVIOUS");
  try {
    const deck = await resolveDeckSnapshot(sb, me, input.deckId);
    if (!deck.ok) return fail(deck.status, deck.error, "DECK_INVALID");
    if (prev !== null) {
      // La revancha solo referencia una partida REAL de los dos: nada de ids ajenos.
      const { data } = await sb.from("duel_matches").select("id, user_id, player_b_id").eq("id", prev).maybeSingle();
      const row = data as { user_id: string; player_b_id: string | null } | null;
      const both = row && ((row.user_id === me && row.player_b_id === input.targetUserId) || (row.user_id === input.targetUserId && row.player_b_id === me));
      if (!both) return fail(404, "Partida anterior no encontrada", "BAD_PREVIOUS");
    }
    const r = await rpc(sb, "social_challenge_create", {
      p_user: me, p_target: input.targetUserId, p_deck: input.deckId, p_previous_match: prev, p_ttl_seconds: CHALLENGE_TTL_SECONDS,
    });
    switch (r.code) {
      case "NOT_FRIENDS": return fail(403, "Solo puedes retar a tus amigos", r.code);
      case "UNAVAILABLE": case "BLOCKED": return UNAVAILABLE();
      case "SELF": return fail(400, "No puedes retarte a ti", r.code);
      case "BUSY": return fail(409, "Uno de los dos ya está en una partida", r.code);
      case "IN_QUEUE": return fail(409, "Uno de los dos está buscando partida ranked: hay que salir de la cola para un duelo amistoso", r.code);
      case "CHALLENGE_LIMIT": return fail(429, "Demasiados retos a la misma persona en poco tiempo: inténtalo más tarde", r.code);
      case "INCOMING_PENDING": return { ok: false, status: 409, error: "Tu amigo ya te ha retado: acepta su reto", code: r.code, data: { challengeId: String(r.challengeId), expiresAt: ms(String(r.expiresAt)), code: "ALREADY_PENDING" } as never };
      case "CREATED":
      case "ALREADY_PENDING":
        return done({ challengeId: String(r.challengeId), expiresAt: ms(String(r.expiresAt)), code: r.code });
      default: return fail(500, "Respuesta inesperada", r.code);
    }
  } catch (e) { logSocial("challenge_create", "RPC", e instanceof Error ? e.message : ""); return fail(500, e instanceof Error ? e.message : "No se pudo crear el reto", "RPC"); }
}

export interface ChallengeResponded { code: string; matchId: string | null; status: ChallengeStatus }

/**
 * Responder a un reto. Solo el retado. Rechazar no penaliza. Aceptar:
 *   1. valida MI mazo (propiedad + legalidad);
 *   2. RPC atómica: reserva `match_id` una sola vez (doble aceptación → mismo id) tras comprobar caducidad, amistad,
 *      bloqueo, partida activa y cola ranked con la hora de la BD;
 *   3. `createPvpMatch(..., { matchId, mode: "PVP_PRIVATE" })`, que revalida los DOS mazos;
 *   4. `social_challenge_mark_matched`; si la partida no se pudo crear, `social_challenge_fail`.
 * Retador = bando A, retado = bando B. Los bandos los fija el servidor.
 */
export async function respondChallenge(
  sb: SupabaseClient, me: string, input: { challengeId: string; accept: boolean; deckId?: string | null },
): Promise<SocialResult<ChallengeResponded>> {
  if (typeof input.challengeId !== "string" || !UUID.test(input.challengeId)) return fail(400, "Reto no válido", "BAD_CHALLENGE");
  const deckId = input.deckId ?? null;
  if (input.accept) {
    if (deckId === null || !UUID.test(deckId)) return fail(400, "Elige un mazo para aceptar", "DECK_REQUIRED");
    const deck = await resolveDeckSnapshot(sb, me, deckId);
    if (!deck.ok) return fail(deck.status, deck.error, "DECK_INVALID");
  }
  try {
    const r = await rpc(sb, "social_challenge_respond", { p_user: me, p_challenge: input.challengeId, p_accept: input.accept, p_deck: input.accept ? deckId : null });
    switch (r.code) {
      case "NOT_FOUND": return fail(404, "Reto no encontrado", r.code);
      case "NOT_TARGET": return fail(404, "Reto no encontrado", r.code); // no se revela a terceros
      case "NOT_PENDING": return fail(409, "Ese reto ya no está pendiente", r.code);
      case "EXPIRED": return fail(409, "El reto ha caducado", r.code);
      case "UNAVAILABLE": return fail(409, "Ese reto ya no está disponible", r.code);
      case "DECK_REQUIRED": return fail(400, "Elige un mazo para aceptar", r.code);
      case "BUSY": return fail(409, "Uno de los dos ya está en una partida", r.code);
      case "IN_QUEUE": return fail(409, "Uno de los dos está buscando partida ranked: hay que salir de la cola para aceptar", r.code);
      case "DECLINED": return done({ code: r.code, matchId: null, status: "DECLINED" });
      case "ALREADY_ACCEPTED": {
        const matchId = String(r.matchId);
        if (r.status === "MATCHED") return done({ code: r.code, matchId, status: "MATCHED" });
        // Aceptado pero la partida aún no nació (carrera o caída entre pasos): se intenta con el MISMO id; un choque de
        // clave primaria significa que la otra petición ya la creó. Nunca dos partidas.
        const made = await createPvpMatch(sb,
          { playerId: String(r.challengerId), deckId: String(r.challengerDeckId) },
          { playerId: me, deckId: String(r.challengedDeckId) },
          { matchId, mode: "PVP_PRIVATE" });
        // FULL GAME AUDIT · antes se respondía MATCHED aunque la partida no existiera (creación fallida por otra causa).
        if (!made.ok && !(await challengeMatchExists(sb, matchId, String(r.challengerId), me))) {
          return fail(409, "La partida se está preparando: inténtalo de nuevo en un momento", "MATCH_PENDING");
        }
        await rpc(sb, "social_challenge_mark_matched", { p_challenge: input.challengeId, p_match: matchId });
        return done({ code: r.code, matchId, status: "MATCHED" });
      }
      case "ACCEPTED": {
        const matchId = String(r.matchId);
        const made = await createPvpMatch(sb,
          { playerId: String(r.challengerId), deckId: String(r.challengerDeckId) },
          { playerId: me, deckId: String(r.challengedDeckId) },
          { matchId, mode: "PVP_PRIVATE" });
        if (!made.ok && await challengeMatchExists(sb, matchId, String(r.challengerId), me)) {
          // FULL GAME AUDIT · carrera: otra aceptación simultánea creó ESTA partida (mismo id). No es un fallo: ni 500 ni
          // `social_challenge_fail` (que cancelaría un reto cuya partida sí existe).
          await rpc(sb, "social_challenge_mark_matched", { p_challenge: input.challengeId, p_match: matchId });
          return done({ code: r.code, matchId, status: "MATCHED" });
        }
        if (!made.ok) {
          logSocial("challenge_match", made.code ?? "MATCH_FAILED");
          await rpc(sb, "social_challenge_fail", { p_challenge: input.challengeId }).catch(() => null);
          const theirs = made.offenderId && made.offenderId !== me;
          return fail(made.status === 500 ? 500 : 409, theirs ? "El mazo de tu amigo ya no es válido: pídele otro reto" : made.error ?? "No se pudo crear la partida", made.code ?? "MATCH_FAILED");
        }
        await rpc(sb, "social_challenge_mark_matched", { p_challenge: input.challengeId, p_match: matchId });
        return done({ code: r.code, matchId, status: "MATCHED" });
      }
      default: return fail(500, "Respuesta inesperada", r.code);
    }
  } catch (e) { logSocial("challenge_respond", "RPC", e instanceof Error ? e.message : ""); return fail(500, e instanceof Error ? e.message : "No se pudo responder al reto", "RPC"); }
}

/**
 * FULL GAME AUDIT (2026-10-07) · ¿la partida de ESTE reto ya existe? (mismo id reservado y los mismos dos jugadores:
 * retador = A, retado = B). En la carrera de aceptaciones simultáneas, la petición que reservó el reto y otra que llegó
 * a la vez («ya aceptado, aún sin partida») intentan crear la MISMA partida con el MISMO id: la clave primaria deja crear
 * una. Para la que pierde, eso no es un fallo — la partida existe —, así que no puede cancelar el reto ni responder 500.
 */
async function challengeMatchExists(sb: SupabaseClient, matchId: string, challengerId: string, me: string): Promise<boolean> {
  const { data } = await sb.from("duel_matches").select("id").eq("id", matchId).eq("user_id", challengerId).eq("player_b_id", me).maybeSingle();
  return !!data;
}

/** Cancelar un reto propio mientras está PENDING. */
export async function cancelChallenge(sb: SupabaseClient, me: string, challengeId: string): Promise<SocialResult<{ code: string }>> {
  if (typeof challengeId !== "string" || !UUID.test(challengeId)) return fail(400, "Reto no válido", "BAD_CHALLENGE");
  try {
    const r = await rpc(sb, "social_challenge_cancel", { p_user: me, p_challenge: challengeId });
    if (r.code === "NOT_PENDING") return fail(409, "Ese reto ya no se puede cancelar", r.code);
    return done({ code: r.code });
  } catch (e) { logSocial("challenge_cancel", "RPC", e instanceof Error ? e.message : ""); return fail(500, e instanceof Error ? e.message : "No se pudo cancelar", "RPC"); }
}
