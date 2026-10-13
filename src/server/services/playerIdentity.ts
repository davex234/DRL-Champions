/**
 * PLAYER IDENTITY 2.0 — SERVICIO (Fase 31, SOLO SERVIDOR).
 *
 * Construye la ÚNICA identidad pública del jugador (`PlayerIdentitySnapshot`) agregando, con
 * consultas acotadas y agrupadas, lo que ya existe:
 *
 *   profiles (id, username, avatar, xp, equipped, packs_opened)   → identidad, nivel, cosméticos
 *   getCompetitivePlayer (Fase 28)                                 → rating, posición, récord, forma, historial
 *   duel_pvp_rating_events (máximo new_rating)                     → rating máximo real
 *   user_cards (uid, card_id) paginado + las 3 de la vitrina       → resumen de colección y vitrina
 *   player_profile_customization (0049)                            → vitrina + logros destacados
 *   user_achievements ∩ ACHIEVEMENTS                               → logros conseguidos
 *   pickem_scores (+ pickem_events.title)                          → Pick'ems YA corregidos
 *   duel_matches entre espectador y jugador                        → cara a cara (h2hSplit, Fase 29)
 *   duel_friendships (si existe)                                   → «quien me bloqueó no existe para mí»
 *   F89 · duel_matches (filas LIGERAS, sin `state` salvo el marcador) → carrera, rachas, momentos, historial paginado
 *   F89 · player_profile_customization.favorite_team_id (0063)     → equipo esports favorito (logo desde el id)
 *   F89 · user_collection_completions + collection_sets (F82)      → colecciones COMPLETADAS (trofeos públicos)
 *
 * `user_cards` y `user_achievements` solo son legibles por su dueño bajo RLS: aquí se leen con el
 * cliente de servicio y SOLO se proyecta lo público. La foto SELF y la PUBLIC las decide
 * `buildPlayerIdentity` (dominio puro). Nada de este servicio escribe economía, rating ni cartas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog, serverCatalogSync } from "@/server/catalog";
import { getVariant } from "@/domain/cards/variants";
import type { VariantId } from "@/domain/cards/types";
import { ACHIEVEMENTS } from "@/domain/progression/achievements";
import { equippedDefs } from "@/domain/cosmetics/catalog";
import { buildTeamCollection } from "@/domain/collections/teamCollection";
import { h2hSplit } from "@/domain/social/social";
import { isAllowedAvatar } from "@/domain/profile/avatars";
import { safeAvatar } from "@/domain/profile/avatars";
import {
  buildPlayerIdentity, publicName, parseShowcase, checkShowcaseOwnership, parseFeatured, checkFeaturedClaimed, parseExpectedVersion, isUuid,
  type IdentityFacts, type CardLookup, type OwnedInstanceFact, type PlayerIdentitySnapshot, type PickemScoreFact,
} from "@/domain/profile/identity";
import { getCompetitivePlayer, readLadderNeighbors } from "./competitive";
import { loadSeasonCalendar } from "./season";
import { resolveCalendar } from "@/domain/season/calendar";
import { badgeFactsFor, ownedBadgeIds } from "./collectionSets";
import { ANY_BADGE_PATTERN } from "@/domain/collectionSets/types";
import { favoriteTeamOptions, parseFavoriteTeam, teamFact } from "@/domain/profile/favoriteTeam";
import {
  careerHighlights, careerModeOf, careerStats, DB_MODE, historyItem, nextCursor, HISTORY_PAGE, PUBLIC_MODES, SELF_MODES,
  type CareerMode, type HistoryItem, type HistoryRowFact,
} from "@/domain/profile/career";
import type { ProfileCollections } from "@/domain/profile/identity";
import { seasonSummaryFor } from "./seasonTrack";

/** FASE 56 · tope de asientos leídos para el tramo de temporada del perfil (una consulta acotada). */
const SEASON_EVENTS_CAP = 500;

export interface IdentityResult<T> { ok: boolean; status: number; error?: string; code?: string; data?: T }
const fail = (status: number, error: string, code?: string): IdentityResult<never> => ({ ok: false, status, error, code });
const done = <T>(data: T): IdentityResult<T> => ({ ok: true, status: 200, data });

const ms = (iso: string | null | undefined): number | null => { if (!iso) return null; const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

/** Tope de ejemplares leídos para el resumen (páginas de 1.000). Suficiente y acotado. */
const MAX_INSTANCES = 20_000;
const PAGE = 1000;

/**
 * Proyección FIJA de `profiles`: añadir una columna aquí es una decisión de privacidad.
 * F89 · `created_at` entra para «miembro desde» y se publica SOLO el mes (`monthOf` en el dominio).
 */
const PROFILE_COLS = "id, username, avatar, xp, equipped, packs_opened, created_at, public_tag";

const CATALOG = ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, description: a.description, icon: a.icon }));
const CATALOG_IDS = new Set(CATALOG.map((a) => a.id));

/** ¿Falta la migración? (tabla o función inexistente). Se degrada en lugar de romper el perfil. */
const isMissingSchema = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === "42P01" || e.code === "42883" || e.code === "PGRST202" || e.code === "PGRST205" || /does not exist|could not find/i.test(e.message ?? ""));

function cardLookup(): CardLookup {
  const cat = serverCatalogSync();
  return (cardId, mintedVersion) => {
    const def = cat.instance(cardId, mintedVersion);
    if (!def) return null;
    const player = cat.player(def.playerId);
    const variant = getVariant(def.variantId as VariantId);
    if (!player || !variant) return null;
    return {
      cardId, variantId: def.variantId, variantLabel: variant.label, rank: variant.rank, serialLimit: variant.serialLimit ?? null,
      ovr: def.ovr, nick: player.nick, team: player.team ?? null, role: player.role ?? null, glow: variant.palette.primary,
    };
  };
}

const rankOf = (cardId: string): number | null => {
  const def = serverCatalogSync().card(cardId);
  return def ? getVariant(def.variantId as VariantId)?.rank ?? null : null;
};

async function allInstanceCards(sb: SupabaseClient, userId: string): Promise<{ uid: string; cardId: string }[]> {
  const out: { uid: string; cardId: string }[] = [];
  for (let from = 0; from < MAX_INSTANCES; from += PAGE) {
    const { data, error } = await sb.from("user_cards").select("uid, card_id").eq("user_id", userId).order("uid", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { uid: string; card_id: string }[];
    for (const r of rows) out.push({ uid: r.uid, cardId: r.card_id });
    if (rows.length < PAGE) break;
  }
  return out;
}

async function customizationOf(sb: SupabaseClient, userId: string): Promise<IdentityFacts["customization"]> {
  const { data, error } = await sb.from("player_profile_customization").select("showcase_card_uids, featured_achievement_ids, version, updated_at").eq("user_id", userId).maybeSingle();
  if (error) { if (isMissingSchema(error)) return null; throw new Error(error.message); }
  const r = data as { showcase_card_uids: string[] | null; featured_achievement_ids: string[] | null; version: number; updated_at: string | null } | null;
  return r ? { showcaseUids: r.showcase_card_uids ?? [], featuredIds: r.featured_achievement_ids ?? [], version: r.version, updatedAt: ms(r.updated_at) } : null;
}

/**
 * F82 · insignias del perfil. Las destacadas se filtran a las que el jugador POSEE (aunque el RPC ya lo exige al
 * guardar). SELF recibe además todas las suyas para el editor. Sin 0062 (columna ausente) → sin insignias, nunca error.
 */
export async function profileBadges(sb: SupabaseClient, playerId: string, isSelf: boolean): Promise<IdentityFacts["badges"]> {
  const { data, error } = await sb.from("player_profile_customization").select("featured_badge_ids").eq("user_id", playerId).maybeSingle();
  const featuredIds = error ? [] : (((data as { featured_badge_ids?: string[] | null } | null)?.featured_badge_ids) ?? []);
  if (!featuredIds.length && !isSelf) return { featured: [], featuredIds: [], owned: [] };
  let owned: string[] = [];
  try { owned = await ownedBadgeIds(sb, playerId); } catch { return { featured: [], featuredIds: [], owned: [] }; }
  const mine = new Set(owned);
  const shown = featuredIds.filter((id) => mine.has(id));
  const facts = await badgeFactsFor(sb, isSelf ? owned : shown);
  const byId = new Map(facts.map((f) => [f.id, f]));
  return {
    featured: shown.map((id) => byId.get(id)).filter((f): f is NonNullable<typeof f> => !!f),
    featuredIds: isSelf ? shown : [],
    owned: isSelf ? facts : [],
  };
}

/** «Quien me bloqueó no existe para mí» (Fase 29). Sin la tabla social (0048 sin aplicar), no hay bloqueo. */
async function blockedByPlayer(sb: SupabaseClient, viewerId: string, playerId: string): Promise<boolean> {
  const lo = viewerId < playerId ? viewerId : playerId, hi = viewerId < playerId ? playerId : viewerId;
  const { data, error } = await sb.from("duel_friendships").select("status, blocked_by").eq("user_lo", lo).eq("user_hi", hi).maybeSingle();
  if (error) return false;
  const r = data as { status: string; blocked_by: string | null } | null;
  return !!r && r.status === "BLOCKED" && r.blocked_by === playerId;
}

/* ───────────────────────────── F89 · carrera, historial, equipo, colecciones ───────────────────────────── */

/** Tope de partidas leídas para la carrera (5 páginas). Si se alcanza, la API lo dice (`sample.capped`). */
const CAREER_CAP = 5000;
/** Columnas LIGERAS: nunca el `state` entero (solo el marcador). */
const CAREER_COLS = "id, mode, user_id, player_b_id, status, winner, closed_reason, closed_by, closed_at, updated_at, difficulty, scoreA:state->scoreA, scoreB:state->scoreB";
/** Terminadas (las mismas que cuenta el competitivo). */
const TERMINAL = "status.in.(COMPLETED,DRAW,UNRESOLVED),closed_reason.not.is.null";

interface CareerRow {
  id: string; mode: string; user_id: string; player_b_id: string | null; status: string; winner: "A" | "B" | null;
  closed_reason: string | null; closed_by: string | null; closed_at: string | null; updated_at: string; difficulty: string | null;
  scoreA: unknown; scoreB: unknown;
}

function toFact(r: CareerRow, cupGames: ReadonlySet<string> = new Set()): HistoryRowFact | null {
  // F86.1 · un cruce de torneo es TOURNAMENT (categoría propia), nunca «duelo privado» (`domain/cups/matchKind`).
  const mode = careerModeOf(r.mode, cupGames.has(r.id));
  if (!mode) return null;
  return {
    matchId: r.id, mode, at: ms(r.updated_at) ?? ms(r.closed_at) ?? 0,
    status: r.status, winner: r.winner, closedReason: r.closed_reason === "ABANDONED" || r.closed_reason === "EXPIRED" ? r.closed_reason : null,
    closedBy: r.closed_by, playerAId: r.user_id, playerBId: r.player_b_id ?? "",
    scoreA: Number(r.scoreA ?? 0) || 0, scoreB: Number(r.scoreB ?? 0) || 0, difficulty: r.difficulty,
  };
}

const modesFor = (isSelf: boolean): readonly CareerMode[] => (isSelf ? SELF_MODES : PUBLIC_MODES);

/** F86.1 · de unas partidas PVP_PRIVATE, cuáles son cruces de TORNEO (enlace único de 0069). Sin 0069: ninguna. */
async function cupGameIdsOf(sb: SupabaseClient, ids: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Set();
  try {
    const { data, error } = await sb.from("cup_matches").select("game_match_id").in("game_match_id", unique);
    if (error) return new Set();
    return new Set(((data ?? []) as { game_match_id: string | null }[]).map((r) => r.game_match_id).filter((x): x is string => !!x));
  } catch { return new Set(); } // lectura opcional: el perfil nunca cae por ella
}

/** F86.1 · cuántas partidas de torneo (con partida creada) tiene un jugador: se restan de «duelos privados». */
async function cupGamesOfPlayer(sb: SupabaseClient, playerId: string): Promise<number> {
  try {
    const { count, error } = await sb.from("cup_matches").select("id", { count: "exact", head: true })
      .not("game_match_id", "is", null).neq("status", "READY").or(`player_a.eq.${playerId},player_b.eq.${playerId}`); // READY con id = reserva aún sin partida
    return error ? 0 : count ?? 0;
  } catch { return 0; } // lectura opcional: el perfil nunca cae por ella
}

/** Filas de carrera ya clasificadas (con `TOURNAMENT` separado de `PRIVATE`) y filtradas a los modos de quien mira. */
async function careerFacts(sb: SupabaseClient, rows: CareerRow[], modes: readonly CareerMode[]): Promise<{ facts: HistoryRowFact[]; read: number }> {
  const cup = await cupGameIdsOf(sb, rows.filter((r) => r.mode === "PVP_PRIVATE").map((r) => r.id));
  const allowed = new Set(modes);
  return { facts: rows.map((r) => toFact(r, cup)).filter((r): r is HistoryRowFact => r !== null && allowed.has(r.mode)), read: rows.length };
}

async function careerRows(sb: SupabaseClient, playerId: string, modes: readonly CareerMode[], limit: number, before: number | null): Promise<CareerRow[]> {
  const out: CareerRow[] = [];
  for (let from = 0; from < limit; from += PAGE) {
    let q = sb.from("duel_matches").select(CAREER_COLS)
      .in("mode", [...new Set(modes.map((m) => DB_MODE[m]))])
      .or(`user_id.eq.${playerId},player_b_id.eq.${playerId}`)
      .or(TERMINAL)
      .order("updated_at", { ascending: false }).order("id", { ascending: false });
    if (before !== null) q = q.lt("updated_at", new Date(before).toISOString());
    const { data, error } = await q.range(from, Math.min(from + PAGE, limit) - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as CareerRow[];
    out.push(...rows);
    if (rows.length < Math.min(PAGE, limit - from)) break;
  }
  return out;
}

/** Nombre y avatar PÚBLICOS de los rivales humanos de una página (una consulta). */
async function rivalsOf(sb: SupabaseClient, playerId: string, rows: HistoryRowFact[]): Promise<Map<string, { userId: string; username: string; avatar: string }>> {
  const ids = [...new Set(rows.filter((r) => r.mode === "RANKED" || r.mode === "PRIVATE" || r.mode === "TOURNAMENT").map((r) => (r.playerAId === playerId ? r.playerBId : r.playerAId)).filter(Boolean))];
  const out = new Map<string, { userId: string; username: string; avatar: string }>();
  if (!ids.length) return out;
  const { data } = await sb.from("profiles").select("id, username, avatar").in("id", ids);
  for (const p of (data ?? []) as { id: string; username: string | null; avatar: string | null }[]) {
    out.set(p.id, { userId: p.id, username: publicName(p.username, p.id), avatar: safeAvatar(p.avatar) });
  }
  return out;
}

async function historyPage(sb: SupabaseClient, playerId: string, rows: HistoryRowFact[], isSelf: boolean): Promise<{ items: HistoryItem[]; nextBefore: number | null }> {
  const page = rows.slice(0, HISTORY_PAGE);
  const rivals = await rivalsOf(sb, playerId, page);
  return {
    items: page.map((r) => historyItem(r, playerId, rivals.get(r.playerAId === playerId ? r.playerBId : r.playerAId) ?? null, isSelf)),
    // Hay página siguiente solo si llegaron MÁS filas que la página (la consulta pide una de más).
    nextBefore: rows.length > HISTORY_PAGE ? nextCursor(page) : null,
  };
}

let TEAM_IDS: { at: number; ids: Set<string> } | null = null;
/** Ids válidos de equipo favorito (catálogo del servidor; se recalcula como mucho cada 60 s). */
function favoriteTeamIds(): Set<string> {
  const now = Date.now();
  if (TEAM_IDS && now - TEAM_IDS.at < 60_000) return TEAM_IDS.ids;
  const cat = serverCatalogSync();
  TEAM_IDS = { at: now, ids: new Set(favoriteTeamOptions(cat.cards, (id) => cat.player(id)).map((t) => t.id)) };
  return TEAM_IDS.ids;
}

/** F89 · equipo favorito. Sin 0063 (columna ausente) → ninguno, nunca error. Un id que ya no es válido no se enseña. */
async function favoriteTeamOf(sb: SupabaseClient, playerId: string) {
  const { data, error } = await sb.from("player_profile_customization").select("favorite_team_id").eq("user_id", playerId).maybeSingle();
  if (error) return null;
  const id = (data as { favorite_team_id?: string | null } | null)?.favorite_team_id ?? null;
  if (!id || !favoriteTeamIds().has(id)) return null;
  return teamFact(id);
}

/** F89 · colecciones F82: compleciones (permanentes) + sets visibles. Sin 0062 → `null` (el perfil sigue). */
async function profileCollections(sb: SupabaseClient, playerId: string): Promise<ProfileCollections | null> {
  const [doneRes, setsRes, badges] = await Promise.all([
    sb.from("user_collection_completions").select("set_id, completed_at").eq("user_id", playerId).order("completed_at", { ascending: false }).limit(200),
    sb.from("collection_sets").select("id, kind, title, logo, status").in("status", ["PUBLISHED", "RETIRED"]),
    ownedBadgeIds(sb, playerId).catch(() => [] as string[]),
  ]);
  if (doneRes.error || setsRes.error) return null;
  const byId = new Map(((setsRes.data ?? []) as { id: string; kind: string; title: string; logo: string | null; status: string }[]).map((s) => [s.id, s]));
  const completed = ((doneRes.data ?? []) as { set_id: string; completed_at: string }[]).filter((r) => byId.has(r.set_id)).map((r) => {
    const s = byId.get(r.set_id)!;
    const kind: "TEAM" | "EDITION" = s.kind === "EDITION" ? "EDITION" : "TEAM";
    return { setId: s.id, title: s.title, kind, logo: kind === "TEAM" ? s.logo : null, day: Math.floor((ms(r.completed_at) ?? 0) / 86_400_000) * 86_400_000 };
  });
  const publishedIds = new Set([...byId.values()].filter((s) => s.status === "PUBLISHED").map((s) => s.id));
  return {
    publishedSets: publishedIds.size,
    publishedCompleted: completed.filter((c) => publishedIds.has(c.setId)).length,
    setsCompleted: completed.length,
    teamSetsCompleted: completed.filter((c) => c.kind === "TEAM").length,
    badgesUnlocked: badges.length,
    completed,
  };
}

/**
 * F89 · página del historial (`GET /api/game/player?id=…&history=1&before=…`). Mismas reglas de visibilidad que el
 * perfil: inexistente o bloqueado → 404; el espectador decide los modos (ajeno: sin duelos privados).
 */
export async function getPlayerHistory(sb: SupabaseClient, viewerId: string | null, playerId: string, before: number | null): Promise<IdentityResult<{ items: HistoryItem[]; nextBefore: number | null }>> {
  if (!isUuid(playerId)) return fail(400, "Jugador no válido");
  try {
    const { data: prow, error: perr } = await sb.from("profiles").select("id").eq("id", playerId).maybeSingle();
    if (perr) throw new Error(perr.message);
    if (!prow) return fail(404, "Jugador no encontrado");
    const isSelf = viewerId !== null && viewerId === playerId;
    if (viewerId && !isSelf && await blockedByPlayer(sb, viewerId, playerId)) return fail(404, "Jugador no encontrado");
    // Una fila de más para saber si hay página siguiente sin otra consulta.
    const { facts: rows } = await careerFacts(sb, await careerRows(sb, playerId, modesFor(isSelf), HISTORY_PAGE + 1, before), modesFor(isSelf));
    return done(await historyPage(sb, playerId, rows, isSelf));
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer el historial");
  }
}

export async function getPlayerIdentity(sb: SupabaseClient, viewerId: string | null, playerId: string, opts: { now?: number } = {}): Promise<IdentityResult<PlayerIdentitySnapshot>> {
  if (!isUuid(playerId)) return fail(400, "Jugador no válido");
  const now = opts.now ?? Date.now();
  const isSelf = viewerId !== null && viewerId === playerId;
  try {
    const { data: prow, error: perr } = await sb.from("profiles").select(PROFILE_COLS).eq("id", playerId).maybeSingle();
    if (perr) throw new Error(perr.message);
    const p = prow as { id: string; username: string; avatar: string | null; xp: number | null; equipped: Record<string, string> | null; packs_opened: number | null; created_at: string | null; public_tag?: string | null } | null;
    if (!p) return fail(404, "Jugador no encontrado");
    if (viewerId && !isSelf && await blockedByPlayer(sb, viewerId, playerId)) return fail(404, "Jugador no encontrado");

    await serverCatalog(sb);

    const [competitive, highestRes, instances, customization, claimedRes, pickemRes, h2hRes, privateRes, gameRes, careerRaw, favoriteTeam, collections, seasonTrack] = await Promise.all([
      getCompetitivePlayer(sb, viewerId ?? playerId, playerId).catch(() => null),
      sb.from("duel_pvp_rating_events").select("new_rating").eq("user_id", playerId).order("new_rating", { ascending: false }).limit(1).maybeSingle(),
      allInstanceCards(sb, playerId),
      customizationOf(sb, playerId),
      sb.from("user_achievements").select("achievement_id, claimed_at").eq("user_id", playerId).in("achievement_id", [...CATALOG_IDS]),
      sb.from("pickem_scores").select("pickem_event_id, points, correct, total, scored_at").eq("user_id", playerId).order("scored_at", { ascending: false }).limit(100),
      viewerId && !isSelf
        ? sb.from("duel_matches").select("id, mode, user_id, player_b_id, status, winner, closed_reason, closed_by").in("mode", ["PVP", "PVP_PRIVATE"])
          .or(`and(user_id.eq.${viewerId},player_b_id.eq.${playerId}),and(user_id.eq.${playerId},player_b_id.eq.${viewerId})`)
          .or("status.in.(COMPLETED,DRAW,UNRESOLVED),closed_reason.not.is.null").limit(100)
        : Promise.resolve({ data: null, error: null }),
      isSelf
        ? sb.from("duel_matches").select("id", { count: "exact", head: true }).eq("mode", "PVP_PRIVATE").or(`user_id.eq.${playerId},player_b_id.eq.${playerId}`)
        : Promise.resolve({ count: null, error: null }),
      // Fase 37 · «sobres abiertos» (solo SELF) sale de la fuente canónica `user_game.packs_opened` (Fase 36.1).
      isSelf
        ? sb.from("user_game").select("packs_opened").eq("user_id", playerId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      // F89 · carrera (filas ligeras), equipo favorito (0063) y colecciones completadas (F82). Todo en paralelo.
      careerRows(sb, playerId, modesFor(isSelf), CAREER_CAP, null),
      favoriteTeamOf(sb, playerId),
      profileCollections(sb, playerId).catch(() => null),
      // F83 · nivel de la ruta de temporada (nunca lanza; sin 0064 o sin temporada → null).
      seasonSummaryFor(sb, playerId, now),
    ]);

    // Vitrina: las instancias referenciadas, SOLO si siguen siendo del jugador (una consulta de ≤ 3 filas).
    let showcaseInstances: OwnedInstanceFact[] = [];
    const uids = customization?.showcaseUids ?? [];
    if (uids.length > 0) {
      const { data: srows, error: serr } = await sb.from("user_cards").select("uid, card_id, serial, minted_version, obtained_at").eq("user_id", playerId).in("uid", uids);
      if (serr) throw new Error(serr.message);
      showcaseInstances = ((srows ?? []) as { uid: string; card_id: string; serial: number | null; minted_version: number | null; obtained_at: string }[])
        .map((r) => ({ uid: r.uid, cardId: r.card_id, serial: r.serial, mintedVersion: r.minted_version, obtainedAt: ms(r.obtained_at) ?? 0 }));
    }

    // Pick'ems: solo filas CORREGIDAS (pickem_scores). Títulos de los 3 más recientes, en una consulta.
    const scoreRows = ((pickemRes.data ?? []) as { pickem_event_id: string; points: number; correct: number; total: number; scored_at: string | null }[]);
    const recentIds = scoreRows.slice(0, 3).map((r) => r.pickem_event_id);
    const titles = new Map<string, string>();
    if (recentIds.length > 0) {
      const { data: trows } = await sb.from("pickem_events").select("id, title").in("id", recentIds);
      for (const t of (trows ?? []) as { id: string; title: string }[]) titles.set(t.id, t.title);
    }
    const pickems: PickemScoreFact[] = scoreRows.map((r) => ({ pickemEventId: r.pickem_event_id, title: titles.get(r.pickem_event_id) ?? null, points: r.points, correct: r.correct, total: r.total, scoredAt: ms(r.scored_at) }));

    const comp = competitive && competitive.ok ? competitive.data! : null;

    // FASE 56 · vecinos públicos en la escalera y tramo de la temporada activa (dos lecturas acotadas, solo lectura).
    const cal = resolveCalendar(loadSeasonCalendar(), now);
    const current = cal.ok ? cal.current : null;
    const badges = await profileBadges(sb, playerId, isSelf);
    const [neighbors, seasonRows] = await Promise.all([
      comp?.position != null ? readLadderNeighbors(sb, comp.position).catch(() => null) : Promise.resolve(null),
      current
        ? sb.from("duel_pvp_rating_events").select("created_at, result, old_rating, new_rating").eq("user_id", playerId)
          .gte("created_at", new Date(current.startsAtMs).toISOString()).lt("created_at", new Date(current.endsAtMs).toISOString())
          .order("created_at", { ascending: false }).limit(SEASON_EVENTS_CAP)
        : Promise.resolve({ data: null, error: null }),
    ]);
    const eq = equippedDefs(p.equipped);
    const teams = buildTeamCollection(instances.map((i) => ({ uid: i.uid, cardId: i.cardId, obtainedAt: 0 })));
    const highest = (highestRes.data as { new_rating: number } | null)?.new_rating ?? null;

    // F89 · carrera: estadísticas + momentos + primera página del historial, de las MISMAS filas.
    const modes = modesFor(isSelf);
    // F86.1 · clasificadas con la regla única (`TOURNAMENT` ≠ `PRIVATE`) y filtradas a los modos de quien mira.
    const { facts: careerList } = await careerFacts(sb, careerRaw, modes);
    const capped = careerRaw.length >= CAREER_CAP;
    const career = {
      stats: careerStats(careerList, playerId, modes, { read: careerRaw.length, capped }),
      highlights: careerHighlights({
        matches: careerList, userId: playerId, modes, capped,
        completions: (collections?.completed ?? []).map((c) => ({ setId: c.setId, title: c.title, kind: c.kind, logo: c.logo, completedAt: c.day })),
      }),
      history: await historyPage(sb, playerId, careerList, isSelf),
    };

    // F86.1 · los cruces de torneo NO son duelos privados: fuera del cara a cara y del contador de duelos privados.
    const h2hRows = ((h2hRes.data ?? []) as { id: string; mode: string; user_id: string; player_b_id: string | null; status: string; winner: "A" | "B" | null; closed_reason: string | null; closed_by: string | null }[]);
    const h2hCup = await cupGameIdsOf(sb, h2hRows.filter((m) => m.mode === "PVP_PRIVATE").map((m) => m.id));
    const ownCupGames = isSelf ? await cupGamesOfPlayer(sb, playerId) : 0;

    const facts: IdentityFacts = {
      profile: { id: p.id, username: p.username, avatar: p.avatar, xp: p.xp ?? 0, equipped: p.equipped, packsOpened: isSelf ? ((gameRes.data as { packs_opened: number } | null)?.packs_opened ?? 0) : null, tag: p.public_tag ?? null },
      cosmetics: {
        title: eq.titulo ? { label: eq.titulo.label, color: eq.titulo.color } : null,
        frame: eq.marco ? { color: eq.marco.color } : null,
        banner: eq.banderin ? { label: eq.banderin.label, color: eq.banderin.color } : null,
      },
      ranked: comp?.rating ? {
        rating: comp.rating.rating, gamesPlayed: comp.rating.gamesPlayed, provisional: comp.rating.provisional,
        wins: comp.stats.wins, losses: comp.stats.losses, draws: comp.stats.draws, position: comp.position, rankedTotal: comp.rankedTotal,
        winrate: comp.stats.winrate, form: comp.stats.form, streak: comp.stats.streak,
      } : null,
      highestRating: comp?.rating ? Math.max(comp.rating.rating, highest ?? comp.rating.rating) : null,
      // F84 · rango de la temporada competitiva activa (público: rango solo tras la colocación; nunca rating de otros sistemas).
      competitive: comp?.competitive?.season ? { seasonName: comp.competitive.season.name, standing: comp.competitive.standing } : null,
      recentMatches: (comp?.recentMatches ?? []).map((m) => ({ matchId: m.matchId, at: m.at, outcome: m.outcome, letter: m.letter, scoreYou: m.scoreYou, scoreRival: m.scoreRival, rival: m.rival })),
      instanceCardIds: instances.map((i) => i.cardId),
      showcaseInstances,
      teams: teams.map((t) => ({ total: t.total, ownedDistinct: t.ownedDistinct })),
      totalCards: serverCatalogSync().cards.length,
      customization,
      claimed: ((claimedRes.data ?? []) as { achievement_id: string; claimed_at: string | null }[]).map((c) => ({ id: c.achievement_id, claimedAt: ms(c.claimed_at) })),
      catalog: CATALOG,
      pickems,
      h2h: h2hRes.data ? h2hSplit(h2hRows.filter((m) => !h2hCup.has(m.id)).map((m) => ({
        status: m.status, winner: m.winner, closedReason: m.closed_reason === "ABANDONED" || m.closed_reason === "EXPIRED" ? m.closed_reason : null,
        closedBy: m.closed_by, playerAId: m.user_id, playerBId: m.player_b_id ?? "", mode: m.mode === "PVP" || m.mode === "PVP_PRIVATE" ? m.mode : "PVE",
      })), viewerId!, playerId) : null,
      privateDuels: isSelf ? Math.max(0, ((privateRes as { count: number | null }).count ?? 0) - ownCupGames) : null,
      neighbors,
      badges,
      createdAt: ms(p.created_at),
      favoriteTeam,
      career,
      collections,
      seasonTrack,
      season: current ? {
        id: current.id, displayName: current.displayName, startsAtMs: current.startsAtMs, endsAtMs: current.endsAtMs, remainingMs: current.remainingMs,
        events: ((seasonRows.data ?? []) as { created_at: string; result: "WIN" | "LOSS" | "DRAW"; old_rating: number; new_rating: number }[])
          .map((r) => ({ createdAt: ms(r.created_at) ?? 0, result: r.result, oldRating: r.old_rating, newRating: r.new_rating })),
      } : null,
    };

    return done(buildPlayerIdentity(facts, { viewerId, now, lookup: cardLookup(), rankOf }));
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer el perfil");
  }
}

/* ───────────────────────────── mutaciones (solo el propio jugador) ───────────────────────────── */

export interface SaveOutcome { code: "SAVED" | "UNCHANGED"; version: number }

const SAVE_ERRORS: Record<string, [number, string]> = {
  TOO_MANY: [400, "La vitrina admite 3 cartas y 3 logros como máximo"],
  DUPLICATE: [400, "No puedes repetir una carta o un logro"],
  NOT_OWNED: [403, "Esa carta no es tuya"],
  LOCKED: [403, "Solo puedes destacar logros que ya has conseguido"],
  BAD_USER: [404, "Jugador no encontrado"],
  BAD_UID: [400, "Carta no válida"],
  BAD_BODY: [400, "Petición no válida"],
  UNKNOWN: [400, "Ese logro no existe"],
};

async function save(sb: SupabaseClient, userId: string, showcase: string[] | null, featured: string[] | null, expectedVersion: number | null): Promise<IdentityResult<SaveOutcome>> {
  const { data, error } = await sb.rpc("player_profile_set", { p_user: userId, p_showcase: showcase, p_featured: featured, p_expected_version: expectedVersion });
  if (error) {
    if (isMissingSchema(error)) return fail(503, "La personalización del perfil todavía no está disponible", "NOT_READY");
    return fail(500, error.message, "RPC");
  }
  const r = data as { code: string; version?: number } | null;
  if (!r) return fail(500, "Respuesta inesperada", "RPC");
  if (r.code === "SAVED" || r.code === "UNCHANGED") return done({ code: r.code, version: r.version ?? 0 });
  if (r.code === "CONFLICT") return fail(409, "Tu perfil cambió en otra pestaña: se ha recargado la versión actual", "CONFLICT");
  const [status, msg] = SAVE_ERRORS[r.code] ?? [500, "No se pudo guardar"];
  return fail(status, msg, r.code);
}

/** Vitrina: forma → propiedad (servicio) → propiedad otra vez dentro del RPC → versión. */
export async function setShowcase(sb: SupabaseClient, userId: string, cardUids: unknown, expectedVersion: unknown): Promise<IdentityResult<SaveOutcome>> {
  const parsed = parseShowcase(cardUids);
  if (!parsed.ok) { const [s, m] = SAVE_ERRORS[parsed.code]; return fail(s, m, parsed.code); }
  const version = parseExpectedVersion(expectedVersion);
  if (!version.ok) return fail(400, "Versión no válida", "BAD_BODY");
  if (parsed.value.length > 0) {
    const { data, error } = await sb.from("user_cards").select("uid").eq("user_id", userId).in("uid", parsed.value);
    if (error) return fail(500, error.message);
    const owned = checkShowcaseOwnership(parsed.value, new Set(((data ?? []) as { uid: string }[]).map((r) => r.uid.toLowerCase())));
    if (!owned.ok) { const [s, m] = SAVE_ERRORS[owned.code]; return fail(s, m, owned.code); }
  }
  return save(sb, userId, parsed.value, null, version.value);
}

/** Logros destacados: catálogo real → reclamados (servicio) → reclamados otra vez dentro del RPC → versión. */
export async function setFeaturedAchievements(sb: SupabaseClient, userId: string, achievementIds: unknown, expectedVersion: unknown): Promise<IdentityResult<SaveOutcome>> {
  const parsed = parseFeatured(achievementIds, CATALOG_IDS);
  if (!parsed.ok) { const [s, m] = SAVE_ERRORS[parsed.code]; return fail(s, m, parsed.code); }
  const version = parseExpectedVersion(expectedVersion);
  if (!version.ok) return fail(400, "Versión no válida", "BAD_BODY");
  if (parsed.value.length > 0) {
    const { data, error } = await sb.from("user_achievements").select("achievement_id").eq("user_id", userId).in("achievement_id", parsed.value);
    if (error) return fail(500, error.message);
    const claimed = checkFeaturedClaimed(parsed.value, new Set(((data ?? []) as { achievement_id: string }[]).map((r) => r.achievement_id)));
    if (!claimed.ok) { const [s, m] = SAVE_ERRORS[claimed.code]; return fail(s, m, claimed.code); }
  }
  return save(sb, userId, null, parsed.value, version.value);
}

/**
 * F82 · insignias destacadas: forma (≤3, sin repetir, id de insignia) → propiedad DENTRO del RPC (`user_cosmetics`)
 * → versión. Enviar un id inventado o ajeno = 403 LOCKED; nunca se equipa algo que no se posee.
 */
export async function setFeaturedBadges(sb: SupabaseClient, userId: string, badgeIds: unknown, expectedVersion: unknown): Promise<IdentityResult<SaveOutcome>> {
  if (!Array.isArray(badgeIds) || badgeIds.length > 3 || badgeIds.some((b) => typeof b !== "string" || !ANY_BADGE_PATTERN.test(b))) {
    return fail(400, "Insignias no válidas (máximo 3)", "BAD_BODY");
  }
  if (new Set(badgeIds).size !== badgeIds.length) return fail(400, "No puedes repetir una insignia", "DUPLICATE");
  const version = parseExpectedVersion(expectedVersion);
  if (!version.ok) return fail(400, "Versión no válida", "BAD_BODY");
  const { data, error } = await sb.rpc("player_profile_set_badges", { p_user: userId, p_badges: badgeIds, p_expected_version: version.value });
  if (error) {
    if (isMissingSchema(error)) return fail(503, "Las insignias del perfil todavía no están disponibles", "NOT_READY");
    return fail(500, error.message, "RPC");
  }
  const r = data as { code: string; version?: number } | null;
  if (!r) return fail(500, "Respuesta inesperada", "RPC");
  if (r.code === "SAVED" || r.code === "UNCHANGED") return done({ code: r.code, version: r.version ?? 0 });
  if (r.code === "CONFLICT") return fail(409, "Tu perfil cambió en otra pestaña: se ha recargado la versión actual", "CONFLICT");
  if (r.code === "LOCKED") return fail(403, "Solo puedes destacar insignias que ya has desbloqueado", "LOCKED");
  if (r.code === "TOO_MANY") return fail(400, "Puedes destacar 3 insignias como máximo", "TOO_MANY");
  const [status, msg] = SAVE_ERRORS[r.code] ?? [400, "No se pudo guardar"];
  return fail(status, msg, r.code);
}

/**
 * F89 · equipo favorito: id EXACTO de un equipo real del catálogo (o `null` para quitarlo) → RPC 0063 con versión.
 * Nunca un nombre, una URL ni un logo del cliente: el logo lo resuelve el servidor desde el id.
 */
export async function setFavoriteTeam(sb: SupabaseClient, userId: string, teamId: unknown, expectedVersion: unknown): Promise<IdentityResult<SaveOutcome>> {
  await serverCatalog(sb);
  const parsed = parseFavoriteTeam(teamId, favoriteTeamIds());
  if (!parsed.ok) return fail(400, parsed.code === "UNKNOWN_TEAM" ? "Ese equipo no existe en Valorosters" : "Equipo no válido", parsed.code);
  const version = parseExpectedVersion(expectedVersion);
  if (!version.ok) return fail(400, "Versión no válida", "BAD_BODY");
  const { data, error } = await sb.rpc("player_profile_set_favorite_team", { p_user: userId, p_team: parsed.value, p_expected_version: version.value });
  if (error) {
    if (isMissingSchema(error)) return fail(503, "El equipo favorito todavía no está disponible", "NOT_READY");
    return fail(500, error.message, "RPC");
  }
  const r = data as { code: string; version?: number } | null;
  if (!r) return fail(500, "Respuesta inesperada", "RPC");
  if (r.code === "SAVED" || r.code === "UNCHANGED") return done({ code: r.code, version: r.version ?? 0 });
  if (r.code === "CONFLICT") return fail(409, "Tu perfil cambió en otra pestaña: se ha recargado la versión actual", "CONFLICT");
  if (r.code === "BAD_TEAM") return fail(400, "Equipo no válido", "BAD_BODY");
  const [status, msg] = SAVE_ERRORS[r.code] ?? [400, "No se pudo guardar"];
  return fail(status, msg, r.code);
}

/** Avatar: solo del conjunto cerrado de emojis (el mismo de /cuenta). Idempotente. */
export async function setAvatar(sb: SupabaseClient, userId: string, avatar: unknown): Promise<IdentityResult<{ avatar: string }>> {
  if (!isAllowedAvatar(avatar)) return fail(400, "Avatar no válido", "BAD_AVATAR");
  const { error } = await sb.from("profiles").update({ avatar }).eq("id", userId);
  if (error) return fail(500, error.message);
  return done({ avatar });
}
