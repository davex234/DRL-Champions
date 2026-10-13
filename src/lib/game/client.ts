"use client";

/**
 * CAPA DE DATOS DEL JUEGO (cliente).
 *
 * Dos vías, a propósito:
 *   · LECTURAS → directas a Supabase con la anon key. RLS ya garantiza que cada
 *     usuario solo ve lo suyo, así que una ruta API intermedia solo añadiría
 *     latencia y código. Es el patrón que el proyecto ya usaba en /ranking.
 *   · ESCRITURAS → siempre por `/api/game/*` y `/api/pickems`, que usan
 *     `service_role` y validan en servidor. El cliente no puede escribir nada.
 */
import { getSupabase } from "@/lib/supabase/client";
import { fetchOwnProfile } from "@/lib/supabase/ownProfile";
import type { CardDef, OwnedCard, Player } from "@/domain/cards/types";
import type { ArtworkByUid } from "@/domain/cards/artwork";
import type { CardOrigin } from "@/collection";
import type { PityState } from "@/domain/packs/pity";
import type { RankRegion } from "@/domain/progression/rank";
import { positionAmong, type AnswerMap } from "@/domain/pickems/progress";

export interface ServerGameState {
  /** F81.2 · id del usuario dueño de este estado (lo añade `fetchGameState`, no el servidor). */
  ownerId?: string;
  credits: number;
  xp: number;
  ownedCards: OwnedCard[];
  origins: Record<string, CardOrigin>;
  lockedUids: string[];
  unopenedPacks: Record<string, number>;
  pity: PityState;
  packsOpened: number;
  mintCounts: Record<string, number>;
  /**
   * Definiciones que el catálogo compilado del navegador NO puede conocer: las cartas que el
   * jugador posee y que se crearon desde el panel de administración. Vacío en el caso normal.
   * Ver `registerServerCards` en `@/data/catalog`.
   */
  catalogPatch?: { cards: CardDef[]; players: Player[] };
  /**
   * Artwork manual ya RESUELTO por ejemplar (`uid` → fichero de su `minted_version`).
   *
   * Viene resuelto del servidor a propósito: si el cliente recibiera «los artworks de esta
   * carta» tendría que elegir versión, y ahí es donde nacen las heurísticas que el bloque
   * de artwork prohíbe. Ausente = sin sesión, o ningún ejemplar tiene artwork.
   */
  artworks?: ArtworkByUid;
}

export interface OpenedCardDTO {
  uid: string;
  cardId: string;
  serial: number | null;
  /** Fase 38 · versión acuñada tal como quedó persistida. */
  mintedVersion?: number | null;
  isNew: boolean;
  value: number;
  bucket: string;
  byPity: boolean;
}

/** Cabecera de autorización con la sesión actual. Lanza si no hay sesión. */
async function authHeaders(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) throw new Error("Cuenta online no configurada");
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Inicia sesión para continuar");
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

/** F81.1 · una apertura que no responde termina en error y reintento (misma clave), no en una espera infinita. */
export const OPEN_TIMEOUT_MS = 25_000;

async function postJson<T>(url: string, body: unknown, timeoutMs?: number): Promise<T> {
  const signal = timeoutMs && typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(timeoutMs) : undefined;
  const res = await fetch(url, { method: "POST", headers: await authHeaders(), body: JSON.stringify(body), signal });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Error ${res.status}`);
  return json as T;
}

/* ────────────────────────────── Estado de juego ────────────────────────────── */

/** Estado real del usuario en servidor. `null` si no hay sesión. */
export async function fetchGameState(): Promise<ServerGameState | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  const res = await fetch("/api/game/state", {
    headers: { authorization: `Bearer ${data.session.access_token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "No se pudo cargar tu progreso");
  const state = (await res.json()) as ServerGameState;
  /*
   * F81.2 · el estado se etiqueta con su DUEÑO. Si la sesión cambió mientras viajaba la lectura (salir/entrar con otra
   * cuenta, otra pestaña), la respuesta es de otra persona: se descarta en vez de pintarla bajo la cuenta nueva.
   */
  const owner = data.session.user.id;
  const now = (await sb.auth.getSession()).data.session?.user?.id ?? null;
  if (now !== owner) throw new Error(STALE_GAME_STATE);
  return { ...state, ownerId: owner };
}

/** F81.2 · la lectura del estado terminó con OTRA sesión activa (se descarta, nunca se pinta). */
export const STALE_GAME_STATE = "La sesión cambió durante la carga";

/* ────────────────────────────────── Sobres ────────────────────────────────── */

/**
 * Identificador de GESTO para las operaciones de sobres (Fase 11).
 *
 * El servidor lo convierte en la clave de idempotencia de la operación. Reintentar el
 * MISMO gesto —el mismo clic— no cobra dos veces ni abre dos sobres; empezar un gesto
 * nuevo sí es una operación nueva, que es lo que el jugador espera.
 *
 * Se genera aquí y no en el servidor porque solo el cliente sabe dónde empieza y acaba un
 * gesto. `crypto.randomUUID` no está en navegadores muy antiguos ni fuera de contextos
 * seguros, así que hay respaldo: sin él la operación sigue funcionando, solo pierde la
 * protección ante reintentos.
 */
export function newGesture(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export const buyPack = (packId: string, ref = newGesture()) =>
  postJson<{ credits: number; packId: string; qty: number }>(
    "/api/game/packs", { action: "buy", packId, ref });

export const openPack = (packId: string, ref = newGesture()) =>
  postJson<{ opened: OpenedCardDTO[]; credits: number; xpGained: number; repeated?: boolean }>(
    "/api/game/packs", { action: "open", packId, ref }, OPEN_TIMEOUT_MS);

/** Fase 41 · ¿puede recibir ahora un Sobre Inicial gratis? (lectura pura; `null` sin sesión). */
export async function fetchStarterStatus(): Promise<import("@/server/services/starter").StarterStatus | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  const res = await fetch("/api/game/starter", { headers: { authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as import("@/server/services/starter").StarterStatus;
}

export const buyAndOpenPack = (packId: string, ref = newGesture()) =>
  postJson<{ opened: OpenedCardDTO[]; credits: number; xpGained: number }>(
    "/api/game/packs", { action: "buy_and_open", packId, ref }, OPEN_TIMEOUT_MS);

/* ────────────────────────────────── Pick'ems ───────────────────────────────── */

export const submitPick = (questionId: string, option: string) =>
  postJson<{ questionId: string; option: string }>("/api/pickems", { questionId, option });

/* ───────────────────────────── Lecturas públicas ───────────────────────────── */

export interface TournamentRow {
  id: string;
  name: string;
  status: string;
  region: string | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  prize_pool: number | null;
  /** 'demo' marca datos de demostración, no resultados reales. */
  source: string;
}

export interface MatchRow {
  id: string;
  event_id: string;
  team_a: string | null;
  team_b: string | null;
  team_a_id: string | null;
  team_b_id: string | null;
  start_time: string | null;
  status: string;
  score_a: number | null;
  score_b: number | null;
  winner_team_id: string | null;
  /** Nombre del ganador (legacy 0002). Es lo que compara el corrector de Pick'ems. */
  winner_team?: string | null;
  round: string | null;
  match_order: number | null;
  /** Fase (0003). La usa el cuadro de eliminatorias para separar grupos de playoffs. */
  stage_id?: string | null;
  /** Fase 24.4 · estructura CONFIRMADA del cuadro (0045). NULL = desconocido; nunca se inventa. */
  winner_to_match_id?: string | null;
  winner_to_slot?: 1 | 2 | null;
  loser_to_match_id?: string | null;
  loser_to_slot?: 1 | 2 | null;
  winner_qualifies?: string | null;
  winner_qualifies_label?: string | null;
  progression_evidence?: string | null;
  progression_confidence?: string | null;
}

export interface PickemQuestion {
  id: string;
  pickem_event_id: string;
  kind: string;
  match_id: string | null;
  prompt: string;
  options: { key: string; label: string }[];
  points: number;
  locks_at: string;
  order_idx: number;
  locked: boolean;
  correct_option: string | null;
}

export interface PickemEventRow {
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  opens_at: string;
  locks_at: string;
  status: string;
}

export async function fetchTournaments(): Promise<TournamentRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("events")
    .select("id, name, status, region, start_date, end_date, location, prize_pool, source")
    .order("start_date", { ascending: false })
    .limit(50);
  return (data as TournamentRow[]) ?? [];
}

export async function fetchTournament(id: string): Promise<TournamentRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("events")
    .select("id, name, status, region, start_date, end_date, location, prize_pool, source")
    .eq("id", id).maybeSingle();
  return (data as TournamentRow) ?? null;
}

const MATCH_BASE_COLUMNS = "id, event_id, team_a, team_b, team_a_id, team_b_id, start_time, status, score_a, score_b, winner_team_id, winner_team, round, match_order, stage_id";
/** Fase 24.4 · columnas de la migración 0045. Fase 24.6 · pueden no existir todavía. */
const MATCH_PROGRESSION_COLUMNS = "winner_to_match_id, winner_to_slot, loser_to_match_id, loser_to_slot, winner_qualifies, winner_qualifies_label, progression_evidence, progression_confidence";

export async function fetchMatches(eventId: string): Promise<MatchRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from("matches")
    .select(`${MATCH_BASE_COLUMNS}, ${MATCH_PROGRESSION_COLUMNS}`)
    .eq("event_id", eventId)
    .order("match_order", { ascending: true });
  if (!error) return (data as MatchRow[]) ?? [];
  /*
   * PRE-0045 (Fase 24.6): sin las columnas de estructura PostgREST responde 42703 y antes esto
   * devolvía una lista vacía — `/pickems` sin partidos por una migración pendiente. Se reintenta
   * con las columnas base: el cuadro se dibuja por resultados (24.3), como corresponde a ese esquema.
   */
  const msg = (error.message ?? "").toLowerCase();
  const missingColumn = error.code === "42703" || (msg.includes("column") && msg.includes("does not exist"));
  if (!missingColumn) return [];
  const base = await sb.from("matches")
    .select(MATCH_BASE_COLUMNS)
    .eq("event_id", eventId)
    .order("match_order", { ascending: true });
  return (base.data as MatchRow[]) ?? [];
}

export interface StageRow {
  id: string; event_id: string; slug: string; name: string; kind: string; order_idx: number;
}

/** Fases del torneo (0003): grupos, suizo, playoffs. Una consulta; lectura pública. */
export async function fetchStages(eventId: string): Promise<StageRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("stages")
    .select("id, event_id, slug, name, kind, order_idx")
    .eq("event_id", eventId)
    .order("order_idx", { ascending: true });
  return (data as StageRow[]) ?? [];
}

export async function fetchPickemEvent(eventId: string): Promise<PickemEventRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("pickem_events")
    .select("id, event_id, title, description, opens_at, locks_at, status")
    .eq("event_id", eventId).maybeSingle();
  return (data as PickemEventRow) ?? null;
}

/** Preguntas por la VISTA pública: nunca expone la respuesta antes del cierre. */
export async function fetchPickemQuestions(pickemEventId: string): Promise<PickemQuestion[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("pickem_questions_public")
    .select("*").eq("pickem_event_id", pickemEventId).order("order_idx");
  return (data as PickemQuestion[]) ?? [];
}

/** Mis respuestas para un Pick'em: questionId -> opción elegida. */
export async function fetchMyAnswers(pickemEventId: string): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) return {};
  const { data: session } = await sb.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return {};

  const { data: sub } = await sb.from("pickem_submissions")
    .select("id").eq("user_id", uid).eq("pickem_event_id", pickemEventId).maybeSingle();
  if (!sub) return {};

  const { data: answers } = await sb.from("pickem_answers")
    .select("question_id, option_key, is_correct, points_award").eq("submission_id", sub.id);

  const out: Record<string, string> = {};
  for (const a of (answers as { question_id: string; option_key: string }[]) ?? []) {
    out[a.question_id] = a.option_key;
  }
  return out;
}

export interface MyScore { points: number; correct: number; total: number }

export async function fetchMyScore(pickemEventId: string): Promise<MyScore | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: session } = await sb.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return null;
  const { data } = await sb.from("pickem_scores")
    .select("points, correct, total").eq("user_id", uid).eq("pickem_event_id", pickemEventId).maybeSingle();
  return (data as MyScore) ?? null;
}

export interface RankingRow {
  id: string; username: string; avatar: string;
  points: number; xp: number; level: number;
  region: RankRegion | null;
}

export async function fetchGlobalRanking(): Promise<RankingRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("ranking_points").select("*").limit(100);
  return (data as RankingRow[]) ?? [];
}

/**
 * Clasificación de una región (Fase 9D). No es el ranking global filtrado: la vista
 * `ranking_points_region` ordena DENTRO de la región, así que el primero de EMEA es
 * el primero de EMEA aunque sea el vigésimo del mundo.
 */
export async function fetchRegionalRanking(region: RankRegion, limit = 100): Promise<RankingRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("ranking_points_region")
    .select("id, username, avatar, points, xp, level, region")
    .eq("region", region)
    .order("points", { ascending: false })
    .order("xp", { ascending: false })
    .limit(limit);
  return (data as RankingRow[]) ?? [];
}

/**
 * Posición real del usuario en la clasificación global.
 *
 * La vista `ranking_points` corta en 100, así que un usuario fuera del top no
 * sabría dónde está. Esto lo cuenta contra la tabla: nº de perfiles con más
 * puntos + 1. Solo lee, y `points` sigue siendo server-only.
 */
export async function fetchMyRankPosition(points: number): Promise<number | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: session } = await sb.auth.getSession();
  if (!session.session) return null;
  if (points <= 0) return null; // sin puntos no se entra en la clasificación
  const { count, error } = await sb.from("profiles")
    .select("id", { count: "exact", head: true })
    .gt("points", points);
  if (error) return null;
  return (count ?? 0) + 1;
}

/**
 * Posición del usuario DENTRO de su región (Fase 9D).
 *
 * Misma cuenta que la global, acotada a la región. Devuelve `null` cuando el usuario no
 * ha declarado región: entonces la posición europea no existe, y decirlo es más honesto
 * que colocarlo en una región que no es la suya.
 */
export async function fetchMyRegionalPosition(
  points: number,
  region: RankRegion | null,
): Promise<number | null> {
  const sb = getSupabase();
  if (!sb || !region) return null;
  const { data: session } = await sb.auth.getSession();
  if (!session.session) return null;
  if (points <= 0) return null;
  const { count, error } = await sb.from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("region", region)
    .gt("points", points);
  if (error) return null;
  return (count ?? 0) + 1;
}

/**
 * Declara la región competitiva del usuario. Es una preferencia suya, no una cifra
 * de juego: `0015_rank_region.sql` le concede `update (region)` y el CHECK de la
 * columna impide cualquier valor fuera de las cuatro del circuito.
 */
export async function setMyRegion(region: RankRegion | null): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sin conexión");
  const { data: session } = await sb.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) throw new Error("Necesitas una cuenta");
  const { error } = await sb.from("profiles").update({ region }).eq("id", uid);
  if (error) throw new Error(error.message);
}

/** Pick'ems disponibles para el selector de clasificación por torneo. */
export async function fetchPickemOptions(): Promise<{ id: string; label: string }[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("pickem_events")
    .select("id, title, events(name)")
    .order("locks_at", { ascending: false });
  return ((data ?? []) as unknown as { id: string; title: string; events: { name: string } | null }[])
    .map((r) => ({ id: r.id, label: r.events?.name ?? r.title }));
}

export interface TournamentRankingRow {
  user_id: string; username: string; avatar: string; points: number; correct: number; total: number;
}

export async function fetchTournamentRanking(pickemEventId: string): Promise<TournamentRankingRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("ranking_pickem_event")
    .select("user_id, username, avatar, points, correct, total")
    .eq("pickem_event_id", pickemEventId).limit(100);
  return (data as TournamentRankingRow[]) ?? [];
}

/* ──────────────────────────── Libro mayor / recompensas ─────────────────────── */

export interface LedgerRow {
  id: string;
  delta: number;
  reason: string;
  ref: string | null;
  balance_after: number;
  created_at: string;
}

/**
 * Movimientos de crédito del usuario. Es el libro mayor real (`credit_transactions`),
 * legible solo por su dueño gracias a RLS. Cada recompensa concedida deja aquí su
 * asiento, así que esta tabla ES el historial de recompensas: no hay una segunda
 * fuente que pudiera desincronizarse.
 */
export async function fetchLedger(limit = 50): Promise<LedgerRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data: session } = await sb.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return [];
  const { data } = await sb.from("credit_transactions")
    .select("id, delta, reason, ref, balance_after, created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as LedgerRow[]) ?? [];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Asiento de recompensa de UN Pick'em concreto, si ya se concedió.
 *
 * `app_grant_reward` escribe siempre un asiento con `ref = pickem:<uuid>:<escalón>`,
 * así que buscar por ese prefijo es preguntar al libro mayor «¿me pagaron este
 * torneo?». No hay una segunda tabla de recompensas que consultar.
 *
 * El id se valida como UUID antes de interpolarlo en el filtro: es el mismo cuidado
 * que ya se toma en `fetchMyTransactions` (BUG-10), aunque aquí venga de datos propios.
 */
export async function fetchPickemReward(pickemEventId: string): Promise<LedgerRow | null> {
  const sb = getSupabase();
  if (!sb || !UUID_RE.test(pickemEventId)) return null;
  const { data: session } = await sb.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return null;
  const { data } = await sb.from("credit_transactions")
    .select("id, delta, reason, ref, balance_after, created_at")
    .eq("user_id", uid)
    .like("ref", `pickem:${pickemEventId}:%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as LedgerRow) ?? null;
}

/** Títulos de los Pick'ems referidos por las recompensas, para dar contexto. */
export async function fetchPickemTitles(ids: string[]): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb || ids.length === 0) return {};
  const { data } = await sb.from("pickem_events")
    .select("id, title, events(name)").in("id", ids);
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as unknown as { id: string; title: string; events: { name: string } | null }[]) {
    out[r.id] = r.events?.name ?? r.title;
  }
  return out;
}

/** Mis sobres sin abrir (para la ficha de recompensas y el perfil). */
export async function fetchMyPacks(): Promise<Record<string, number>> {
  const sb = getSupabase();
  if (!sb) return {};
  const { data: session } = await sb.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return {};
  const { data } = await sb.from("user_packs").select("pack_id, qty").eq("user_id", uid);
  const out: Record<string, number> = {};
  for (const p of (data as { pack_id: string; qty: number }[]) ?? []) if (p.qty > 0) out[p.pack_id] = p.qty;
  return out;
}

/** Puntos y perfil del usuario (para rango y cabecera). */
export async function fetchMyProfile(): Promise<{ points: number; xp: number; credits: number; username: string; avatar: string } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: session } = await sb.auth.getSession();
  const s = session.session;
  if (!s?.user.id) return null;
  // F69 · xp/credits son columnas privadas: se leen por el servidor (`/api/game/me`), no por REST.
  const p = await fetchOwnProfile(s.access_token, s.user.id);
  return p ? { points: p.points, xp: p.xp, credits: p.credits, username: p.username, avatar: p.avatar } : null;
}

/* ───────────────────────── Pick'ems · modo completo (Fase 24.2) ───────────────────────── */

/** Un Pick'em con el torneo real del que cuelga. Es lo que lista el selector de torneos. */
export interface PickemEventSummary {
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  opens_at: string;
  locks_at: string;
  status: string;
  events: {
    name: string; source: string; status: string;
    start_date: string | null; end_date: string | null;
  } | null;
}

const PICKEM_EVENT_COLUMNS =
  "id, event_id, title, description, opens_at, locks_at, status, events(name, source, status, start_date, end_date)";

/** Todos los Pick'ems del circuito, con su torneo. Una sola consulta. */
export async function fetchPickemEvents(): Promise<PickemEventSummary[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from("pickem_events")
    .select(PICKEM_EVENT_COLUMNS)
    .order("locks_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as PickemEventSummary[]);
}

export async function fetchPickemEventById(pickemEventId: string): Promise<PickemEventSummary | null> {
  const sb = getSupabase();
  if (!sb || !UUID_RE.test(pickemEventId)) return null;
  const { data } = await sb.from("pickem_events")
    .select(PICKEM_EVENT_COLUMNS).eq("id", pickemEventId).maybeSingle();
  return (data as unknown as PickemEventSummary) ?? null;
}

interface AnswerRow {
  submission_id?: string;
  question_id: string;
  option_key: string;
  is_correct: boolean | null;
  points_award: number | null;
}

const toAnswerMap = (rows: AnswerRow[]): AnswerMap => {
  const out: AnswerMap = {};
  for (const a of rows) {
    out[a.question_id] = { option: a.option_key, isCorrect: a.is_correct, pointsAward: a.points_award };
  }
  return out;
};

/**
 * Mis respuestas CON lo que dejó escrito el corrector (`is_correct`, `points_award`).
 *
 * Es la fuente de «acertada / fallada / +N»: esas dos columnas solo las escribe
 * `app_score_pickem_event`. El cliente las lee; no las deduce.
 */
export async function fetchMyAnswerDetails(pickemEventId: string): Promise<AnswerMap> {
  const sb = getSupabase();
  if (!sb) return {};
  const { data: session } = await sb.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return {};

  const { data: sub } = await sb.from("pickem_submissions")
    .select("id").eq("user_id", uid).eq("pickem_event_id", pickemEventId).maybeSingle();
  if (!sub) return {};

  const { data: answers } = await sb.from("pickem_answers")
    .select("question_id, option_key, is_correct, points_award").eq("submission_id", sub.id);
  return toAnswerMap((answers as AnswerRow[]) ?? []);
}

/** Un torneo en el que participé, resumido. Todo sale de tablas server-authoritative. */
export interface PickemHistoryRow {
  pickemEventId: string;
  eventId: string;
  name: string;
  isDemo: boolean;
  status: string;
  eventStatus: string | null;
  startDate: string | null;
  endDate: string | null;
  locksAt: string;
  /** `pickem_scores` — `null` si el torneo aún no se ha corregido para mí. */
  score: MyScore | null;
  /** Cuántas respondí. */
  answered: number;
  questions: PickemQuestion[];
  answers: AnswerMap;
  /** Posición entre las puntuaciones del torneo (criterio de la vista: puntos desc). */
  position: number | null;
  /** Asiento de la recompensa concedida, si la hubo. */
  reward: LedgerRow | null;
}

/**
 * MI HISTORIAL de Pick'ems: los torneos en los que tengo una submission.
 *
 * Seis consultas en total, todas por lote (`in (...)`), da igual cuántos torneos haya. No
 * inventa nada: un torneo sin submission mía no aparece, y un torneo sin `pickem_scores`
 * sale con `score: null`, no con ceros.
 */
export async function fetchMyPickemHistory(): Promise<PickemHistoryRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data: session } = await sb.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return [];

  const { data: subs, error: subErr } = await sb.from("pickem_submissions")
    .select("id, pickem_event_id").eq("user_id", uid);
  if (subErr) throw new Error(subErr.message);
  const submissions = (subs ?? []) as { id: string; pickem_event_id: string }[];
  if (submissions.length === 0) return [];

  const ids = submissions.map((s) => s.pickem_event_id);
  const subIds = submissions.map((s) => s.id);

  const [evRes, qRes, aRes, scRes, rwRes] = await Promise.all([
    sb.from("pickem_events").select(PICKEM_EVENT_COLUMNS).in("id", ids),
    sb.from("pickem_questions_public").select("*").in("pickem_event_id", ids).order("order_idx"),
    sb.from("pickem_answers").select("submission_id, question_id, option_key, is_correct, points_award").in("submission_id", subIds),
    sb.from("pickem_scores").select("pickem_event_id, user_id, points, correct, total").in("pickem_event_id", ids),
    sb.from("credit_transactions").select("id, delta, reason, ref, balance_after, created_at")
      .eq("user_id", uid).like("ref", "pickem:%").order("created_at", { ascending: false }),
  ]);
  for (const r of [evRes, qRes, aRes, scRes, rwRes]) if (r.error) throw new Error(r.error.message);

  const events = (evRes.data ?? []) as unknown as PickemEventSummary[];
  const questions = (qRes.data ?? []) as PickemQuestion[];
  const answers = (aRes.data ?? []) as AnswerRow[];
  const scores = (scRes.data ?? []) as { pickem_event_id: string; user_id: string; points: number; correct: number; total: number }[];
  const rewards = (rwRes.data ?? []) as LedgerRow[];

  const subByEvent = new Map(submissions.map((s) => [s.pickem_event_id, s.id]));
  const questionsByEvent = new Map<string, PickemQuestion[]>();
  for (const q of questions) {
    const arr = questionsByEvent.get(q.pickem_event_id);
    if (arr) arr.push(q); else questionsByEvent.set(q.pickem_event_id, [q]);
  }
  const answersBySub = new Map<string, AnswerRow[]>();
  for (const a of answers) {
    const arr = answersBySub.get(a.submission_id!);
    if (arr) arr.push(a); else answersBySub.set(a.submission_id!, [a]);
  }
  const scoresByEvent = new Map<string, typeof scores>();
  for (const s of scores) {
    const arr = scoresByEvent.get(s.pickem_event_id);
    if (arr) arr.push(s); else scoresByEvent.set(s.pickem_event_id, [s]);
  }
  const rewardByEvent = new Map<string, LedgerRow>();
  for (const r of rewards) {
    const parts = (r.ref ?? "").split(":");
    if (parts[0] === "pickem" && parts[1] && !rewardByEvent.has(parts[1])) rewardByEvent.set(parts[1], r);
  }

  const rows: PickemHistoryRow[] = [];
  for (const ev of events) {
    const subId = subByEvent.get(ev.id);
    const myAnswers = toAnswerMap(subId ? (answersBySub.get(subId) ?? []) : []);
    const evScores = scoresByEvent.get(ev.id) ?? [];
    rows.push({
      pickemEventId: ev.id,
      eventId: ev.event_id,
      name: ev.events?.name ?? ev.title,
      isDemo: ev.events?.source === "demo",
      status: ev.status,
      eventStatus: ev.events?.status ?? null,
      startDate: ev.events?.start_date ?? null,
      endDate: ev.events?.end_date ?? null,
      locksAt: ev.locks_at,
      score: (() => {
        const mine = evScores.find((s) => s.user_id === uid);
        return mine ? { points: mine.points, correct: mine.correct, total: mine.total } : null;
      })(),
      answered: Object.keys(myAnswers).length,
      questions: questionsByEvent.get(ev.id) ?? [],
      answers: myAnswers,
      position: positionAmong(evScores, uid),
      reward: rewardByEvent.get(ev.id) ?? null,
    });
  }
  rows.sort((a, b) => Date.parse(b.locksAt) - Date.parse(a.locksAt));
  return rows;
}
