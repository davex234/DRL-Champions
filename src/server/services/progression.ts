/**
 * PROGRESIÓN — SERVICIO CON AUTORIDAD DE SERVIDOR (Fase 9E, SOLO SERVIDOR).
 *
 * El único sitio donde avanza el pase de temporada y se reclaman logros. Une piezas que
 * ya existían y no reimplementa ninguna:
 *
 *   · MOTOR       → `@/battlepass` (Fase 6 de Colección), puro y determinista.
 *   · TEMPORADA   → `@/data/season`, datos.
 *   · MÉTRICAS    → las tablas REALES del jugador. No hay contadores nuevos.
 *   · RECOMPENSAS → `app_grant_reward`, la RPC que ya existe, con su clave de
 *                   idempotencia y su asiento en `credit_transactions`.
 *
 * FRONTERAS DE SEGURIDAD
 *
 *   1. El `userId` viene del token (`getSession`), nunca del cuerpo de la petición.
 *   2. El cliente NO envía progreso. El servidor lee las métricas de la base de datos y
 *      calcula. Un cliente que dijera «he abierto 1000 sobres» no cambia nada.
 *   3. Reclamar dos veces no paga dos veces: lo impiden la clave primaria de
 *      `user_achievements` y el `ref` de `app_grant_reward`, de forma independiente.
 *   4. El carril competitivo lo abre el servidor comparando `profiles.points` con el
 *      umbral de la temporada. El motor solo guarda la decisión.
 *   5. El carril de pago NO se puede abrir pagando: no hay pasarela (§12). Se abre con
 *      fichas de evento, que se ganan jugando.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PassEngine, migratePassState, freshPassState, levelProgress, missionProgress,
  assignMission, rollMissions, trackOf,
  type PassState, type PassTrack, type Reward, type MetricSnapshot, type ActiveMission, type MissionKind,
} from "@/battlepass";
import { legacyMetricKey } from "@/battlepass/missions";
import { CURRENT_SEASON } from "@/data/season";
import { ACHIEVEMENTS, type AchievementContext, type AchievementDef } from "@/domain/progression/achievements";
import { expiresAt as missionExpiresAt } from "@/domain/progression/periods";
import { resolvePassWindows, windowNeeds, countKey, newDistinctSince, missionViewsOf, type WindowNeed, type ResolveResult } from "@/domain/progression/rotation";
import { SEASON_CALENDAR } from "@/data/seasonCalendar";
import { awardMany } from "./rewards";
import { countPlayedMatches, countWonMatches } from "./matchCounts";

export interface ServiceResult<T> {
  ok: boolean;
  status: number;
  error?: string;
  data?: T;
}

const ok = <T,>(data: T): ServiceResult<T> => ({ ok: true, status: 200, data });
const fail = (status: number, error: string): ServiceResult<never> => ({ ok: false, status, error });

// ───────────────────────────── Métricas reales ─────────────────────────────

/**
 * Instantánea de métricas del jugador, leída de las tablas donde ya vive cada cifra.
 *
 * Ninguna de estas cuentas se guarda en una tabla de progresión: duplicar un contador es
 * la forma más segura de que las dos copias dejen de coincidir. Se calcula al vuelo, con
 * consultas de solo recuento (`head: true`), que no traen filas.
 */
export async function metricsFor(admin: SupabaseClient, userId: string): Promise<MetricSnapshot> {
  return (await loadFacts(admin, userId)).metrics;
}

/** Métricas + contexto de logros, de UNA lectura. El contexto es el mismo que evalúa el catálogo. */
export interface PlayerFacts {
  metrics: MetricSnapshot;
  ctx: AchievementContext;
  /** Fase 42 · filas (card_id, obtenida en) para contar cartas distintas nuevas desde el inicio de una ventana. */
  cardRows: { card_id: string; obtainedAt: number | null }[];
  /** Fase 42 · alta de la cuenta (ms) o `null`. */
  accountCreatedAt: number | null;
}

/**
 * SANEAMIENTO POST F47 · RESPUESTAS DE PICK’EM DE UN JUGADOR.
 *
 * `pickem_answers` (0012) NO tiene columna `user_id`: la propiedad va por
 * `submission_id → pickem_submissions.user_id`, igual que el SQL canónico de analítica (0030) y que el
 * cliente (`lib/game/client`). Filtrar por `user_id` no devolvía 0: devolvía 42703 («column
 * pickem_answers.user_id does not exist»), que con `head: true` (HEAD, sin cuerpo) llega con `message`
 * vacío. En `loadFacts` se tragaba (`?? 0`, métrica siempre 0); en `windowCounts` reventaba → 500 de
 * `GET /api/game/meta`.
 *
 * `sinceIso` acota por `created_at` (recuento de ventana); `null` = de siempre.
 */
async function countPickemAnswers(
  admin: SupabaseClient, userId: string, sinceIso: string | null,
): Promise<{ count: number | null; error: DbError | null }> {
  const subs = await admin.from("pickem_submissions").select("id").eq("user_id", userId);
  if (subs.error) return { count: null, error: subs.error };
  const ids = ((subs.data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return { count: 0, error: null };
  let q = admin.from("pickem_answers").select("id", { count: "exact", head: true }).in("submission_id", ids);
  if (sinceIso) q = q.gte("created_at", sinceIso);
  const { count, error } = await q;
  return { count, error };
}

export async function loadFacts(admin: SupabaseClient, userId: string): Promise<PlayerFacts> {
  const [profile, cards, duels, wins, decks, picks, game] = await Promise.all([
    admin.from("profiles").select("packs_opened, points, region, created_at").eq("id", userId).maybeSingle(),
    /*
     * FASE 27 · Se traen los `card_id` (no un recuento) por dos motivos reales: «cartas distintas»
     * contaba EJEMPLARES (dos copias de la misma carta sumaban 2 a «Consigue 5 cartas nuevas»), y los
     * logros de colección (MVP, Icon, Team Heretics, EMEA) necesitan saber QUÉ cartas se poseen para
     * poder reclamarse: hasta hoy devolvían 0 en servidor y eran inreclamables.
     */
    admin.from("user_cards").select("card_id, obtained_at").eq("user_id", userId),
    // Terminada = cualquier estado final del orquestador. Un empate cuenta como
    // partida jugada, que es lo que pregunta la misión.
    // CORE GAME LOOP · «partidas que cuentan» (`matchCounts`): PvE + ranked en los dos asientos; ni privadas, ni
    // torneos, ni Draft. Antes una privada contaba para el asiento A y el B de ranked nunca progresaba.
    countPlayedMatches(admin, userId),
    countWonMatches(admin, userId),
    admin.from("duel_decks").select("id", { count: "exact", head: true }).eq("user_id", userId),
    // SANEAMIENTO POST F47 · `pickem_answers` NO tiene `user_id`: la propiedad va por `submission_id`.
    countPickemAnswers(admin, userId, null),
    /*
     * FASE 36.1 · SOBRES ABIERTOS = `user_game.packs_opened`. Lo incrementa SOLO `app_apply_pack_open`, una vez por
     * apertura real (el reintento con la misma clave vuelve antes de sumar) y en la misma transacción que la fila de
     * `economy_ops` (kind `open_pack`). Comprar (`app_buy_pack`), recibir (`app_grant_pack`, `app_grant_reward`, alta)
     * o poseer un sobre no lo mueven. `profiles.packs_opened` no lo incrementa nadie en servidor: se sigue leyendo
     * SOLO para interpretar baselines antiguas (`packs_opened@legacy`), nunca como progreso nuevo.
     */
    admin.from("user_game").select("packs_opened").eq("user_id", userId).maybeSingle(),
  ]);

  const p = profile.data as { packs_opened: number; points: number; region: string | null; created_at?: string | null } | null;
  const rows = ((cards.data ?? []) as { card_id: string; obtained_at?: string | null }[]);
  const ownedCardIds = new Set(rows.map((r) => r.card_id));
  const packsOpened = (game.data as { packs_opened: number } | null)?.packs_opened ?? 0;

  return {
    metrics: {
      packs_opened: packsOpened,
      [legacyMetricKey("packs_opened")]: p?.packs_opened ?? 0,
      points: p?.points ?? 0,
      region_set: p?.region ? 1 : 0,
      owned_cards: rows.length,
      distinct_cards: ownedCardIds.size,
      duels_played: duels.count ?? 0,
      duels_won: wins.count ?? 0,
      decks_saved: decks.count ?? 0,
      picks_made: picks.count ?? 0,
    },
    ctx: { packsOpened, ownedCardIds },
    cardRows: rows.map((r) => ({ card_id: r.card_id, obtainedAt: r.obtained_at ? Date.parse(r.obtained_at) || null : null })),
    accountCreatedAt: p?.created_at ? Date.parse(p.created_at) || null : null,
  };
}

type DbError = { message?: string; code?: string; hint?: string | null };
type CountQuery = PromiseLike<{ count: number | null; error: DbError | null }>;

/**
 * SANEAMIENTO POST F47 · un error de PostgREST en una consulta `head: true` viaja como HEAD y por tanto
 * SIN cuerpo: `message` llega vacío y `new Error(error.message)` producía un `Error` mudo. Se conserva el
 * código SQL, la tabla y el `hint`; `details` se omite a propósito porque puede reproducir valores de fila.
 */
function dbError(table: string, e: DbError): Error {
  const parts = [e.code, e.message, e.hint].filter((x): x is string => typeof x === "string" && x.length > 0);
  return new Error(`[${table}] ${parts.length ? parts.join(" · ") : "error sin detalle (HEAD sin cuerpo)"}`);
}

/**
 * FASE 42 · «DESDE EL INICIO DE LA VENTANA», con hechos fechados por el servidor. Solo los recuentos que pide
 * `windowNeeds` (≤ 5 por tipo rotatorio vencido); en paralelo, de solo recuento (`head: true`), nunca en bucle por fila.
 */
async function windowCounts(admin: SupabaseClient, userId: string, needs: readonly WindowNeed[], cardRows: PlayerFacts["cardRows"]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(needs.map(async (n) => {
    const iso = new Date(n.startsAt).toISOString();
    let q: CountQuery | null = null;
    let table = "";
    switch (n.metric) {
      case "duels_played":
        table = "duel_matches";
        q = countPlayedMatches(admin, userId, { column: "updated_at", from: iso });
        break;
      case "duels_won":
        table = "duel_matches";
        q = countWonMatches(admin, userId, { column: "updated_at", from: iso });
        break;
      case "packs_opened":
        table = "economy_ops";
        q = admin.from("economy_ops").select("ref", { count: "exact", head: true })
          .eq("user_id", userId).eq("kind", "open_pack").gte("created_at", iso) as unknown as CountQuery;
        break;
      case "picks_made": {
        // SANEAMIENTO POST F47 · por `submission_id` (ver `countPickemAnswers`), nunca por `user_id`.
        const r = await countPickemAnswers(admin, userId, iso);
        if (r.error) throw dbError("pickem_answers", r.error);
        out[countKey(n.metric, n.startsAt)] = r.count ?? 0;
        return;
      }
      case "distinct_cards":
        out[countKey(n.metric, n.startsAt)] = newDistinctSince(cardRows, n.startsAt);
        return;
    }
    if (!q) return;
    const { count, error } = await q;
    if (error) throw dbError(table, error);
    out[countKey(n.metric, n.startsAt)] = count ?? 0;
  }));
  return out;
}

const SEASON_STARTS_AT = (() => {
  const e = SEASON_CALENDAR.find((x) => x.passSeasonId === CURRENT_SEASON.id);
  return e ? Date.parse(e.startsAt) : null;
})();

interface Resolved { facts: PlayerFacts; version: string | null; stored: PassState; resolved: ResolveResult }

/** Lee hechos + pase y calcula el estado que corresponde a `now`. NO escribe. */
async function resolveForUser(admin: SupabaseClient, userId: string, now: number): Promise<Resolved> {
  const [facts, loaded] = await Promise.all([loadFacts(admin, userId), loadPassVersioned(admin, userId)]);
  const needs = windowNeeds(loaded.state, CURRENT_SEASON, userId, now);
  const sinceWindow = needs.length ? await windowCounts(admin, userId, needs, facts.cardRows) : {};
  const resolved = resolvePassWindows({
    state: loaded.state, season: CURRENT_SEASON, userId, metrics: facts.metrics, sinceWindow, now,
    accountCreatedAt: facts.accountCreatedAt, seasonStartsAt: SEASON_STARTS_AT,
  });
  return { facts, version: loaded.version, stored: loaded.state, resolved };
}

/**
 * FASE 42 · MATERIALIZACIÓN EXPLÍCITA. Solo desde mutaciones (reclamos, «actualizar misiones», POST de estado): guarda
 * el estado resuelto si difiere del guardado. Determinista, así que otra pestaña que lo haga a la vez escribe lo mismo;
 * si gana ella (conflicto), se relee y se sigue con lo suyo.
 */
async function ensurePass(admin: SupabaseClient, userId: string, now: number): Promise<{ state: PassState; version: string | null; facts: PlayerFacts }> {
  const r = await resolveForUser(admin, userId, now);
  if (!r.resolved.changed) return { state: r.stored, version: r.version, facts: r.facts };
  try {
    const version = await savePass(admin, userId, r.resolved.state, r.version);
    return { state: r.resolved.state, version, facts: r.facts };
  } catch (e) {
    if (!(e instanceof PassConflictError)) throw e;
    const again = await resolveForUser(admin, userId, now);
    if (again.resolved.changed) throw new PassConflictError();
    return { state: again.stored, version: again.version, facts: again.facts };
  }
}

// ───────────────────────────── Estado del pase ─────────────────────────────

interface PassRow { user_id: string; season_id: string; state: PassState; updated_at?: string | null }

/**
 * FASE 41 · CONCURRENCIA OPTIMISTA DEL PASE. `user_pass.state` es un jsonb que se lee, se modifica en memoria y se
 * reescribe entero. Sin guarda, dos escrituras cruzadas (dos reclamos, o un reclamo y una rotación al leer) se pisaban:
 * la segunda borraba el `claimed` de la primera y la misión volvía a ser reclamable → la XP del pase se sumaba otra vez
 * (el crédito no, por la clave del libro mayor). Ahora cada escritura exige la versión (`updated_at`) que leyó.
 */
export class PassConflictError extends Error {
  constructor() { super("El pase ha cambiado mientras se guardaba"); this.name = "PassConflictError"; }
}

interface VersionedPass { state: PassState; version: string | null }

/**
 * Carga el pase del jugador, creándolo si no existe y avanzando de temporada si la fila
 * guardada es de una anterior. `migratePassState` sanea cualquier estado antiguo, así que
 * un cambio de forma del `PassState` no rompe a nadie.
 */
async function loadPass(admin: SupabaseClient, userId: string): Promise<PassState> {
  return (await loadPassVersioned(admin, userId)).state;
}

async function loadPassVersioned(admin: SupabaseClient, userId: string): Promise<VersionedPass> {
  const { data } = await admin.from("user_pass")
    .select("user_id, season_id, state, updated_at").eq("user_id", userId).maybeSingle();
  const row = data as PassRow | null;

  if (!row) return { state: freshPassState(CURRENT_SEASON.id), version: null };
  const version = row.updated_at ?? null;
  const state = migratePassState(row.state, CURRENT_SEASON.id);
  // Temporada distinta: se archiva y se empieza limpio, conservando el historial.
  if (state.seasonId !== CURRENT_SEASON.id) {
    const engine = new PassEngine(state, CURRENT_SEASON);
    return { state: engine.advanceSeason(CURRENT_SEASON.id, Date.now()).state, version };
  }
  return { state, version };
}

/** Guarda el pase SOLO si nadie lo ha escrito desde que se leyó (`version`). Devuelve la versión nueva. */
async function savePass(admin: SupabaseClient, userId: string, state: PassState, version: string | null): Promise<string | null> {
  const updatedAt = new Date().toISOString();
  if (version === null) {
    const { data, error } = await admin.from("user_pass")
      .insert({ user_id: userId, season_id: state.seasonId, state, updated_at: updatedAt }).select("updated_at");
    if (error) {
      if (error.code === "23505" || /duplicate/i.test(error.message ?? "")) throw new PassConflictError();
      throw new Error(error.message);
    }
    return ((data as { updated_at?: string }[] | null)?.[0]?.updated_at) ?? updatedAt;
  }
  const { data, error } = await admin.from("user_pass")
    .update({ season_id: state.seasonId, state, updated_at: updatedAt })
    .eq("user_id", userId).eq("updated_at", version).select("updated_at");
  if (error) throw new Error(error.message);
  const rows = (data as { updated_at?: string }[] | null) ?? [];
  if (rows.length === 0) throw new PassConflictError();
  return rows[0].updated_at ?? updatedAt;
}

/**
 * Concede una lista de recompensas por LA RUTA ÚNICA (`services/rewards`).
 *
 * Fase 10: antes esta función hacía dos escrituras. Llamaba a `app_grant_reward` con los
 * cuatro campos que la RPC entendía y, DESPUÉS, guardaba los cosméticos con un `upsert`
 * aparte —fuera de la transacción de la RPC—. Ese orden tenía un agujero: si el `upsert`
 * fallaba, la puerta de idempotencia ya estaba cerrada por el asiento del libro mayor, así
 * que al reintentar no se concedía nada y el jugador se quedaba sin el cosmético para
 * siempre.
 *
 * Ahora es una sola llamada y una sola transacción. Además, un carril del pase que llevara
 * una CARTA —que `Reward` admite y esto no sabía entregar— se concede igual que el resto.
 *
 * `ref` sigue siendo la clave de idempotencia y no cambia de forma: las claves ya escritas
 * en el libro mayor de fases anteriores se siguen reconociendo.
 */
async function grantRewards(
  admin: SupabaseClient, userId: string, rewards: Reward[], ref: string, reason: string,
): Promise<void> {
  const results = await awardMany(admin, userId, rewards, ref, reason);
  // Lo que el servidor no sabe entregar se REGISTRA en vez de perderse en silencio: es la
  // señal de que una temporada nueva ha metido un tipo de recompensa sin ruta de entrega.
  for (const r of results) {
    if (r.unsupported.length > 0) {
      console.warn(`[progresion] ${ref}: sin ruta de entrega para ${r.unsupported.join(", ")}`);
    }
  }
}

// ───────────────────────────── Vista pública ─────────────────────────────

export interface PassTrackLevelView {
  level: number;
  reward: Reward;
  claimed: boolean;
  claimable: boolean;
}

export interface PassMissionView {
  id: string;
  label: string;
  kind: string;
  current: number;
  goal: number;
  complete: boolean;
  claimed: boolean;
  rewardCredits: number;
  xp: number;
  /** Métrica real que mide (`packs_opened`, `duels_won`, `distinct_cards`…). Fase 27. */
  metric: string;
  /** Sobre que da al reclamarse, si lo da (de la definición del pool). */
  packId: string | null;
  packCount: number;
  /** Reloj lógico de la tanda (servidor). Identifica la asignación. */
  assignedAt: number;
  /** Fin de la ventana de esta tanda (diaria/semanal), o `null` si no caduca. Lo fija el servidor. */
  expiresAt: number | null;
}

export interface ProgressionView {
  /** Reloj del servidor en el momento de la lectura: el cliente solo cuenta hacia atrás desde aquí. */
  serverNow: number;
  season: { id: string; name: string; maxLevel: number };
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForNext: number;
  progress: number;
  premium: boolean;
  competitiveUnlocked: boolean;
  competitiveMinPoints: number;
  points: number;
  /** Cosméticos equipados, FAMILIA → id. Vacío si no lleva ninguno. */
  equipped: Record<string, string>;
  tracks: Record<PassTrack, PassTrackLevelView[]>;
  missions: PassMissionView[];
  achievements: AchievementView[];
  cosmetics: string[];
}

export interface AchievementView {
  id: string;
  name: string;
  description: string;
  icon: string;
  reward: number;
  goal: number;
  current: number;
  complete: boolean;
  claimed: boolean;
  /** Cuándo se reclamó (`user_achievements.claimed_at`), o `null`. Fase 27. */
  claimedAt: string | null;
}

function trackView(
  season: typeof CURRENT_SEASON, track: PassTrack, state: PassState, reached: number, open: boolean,
): PassTrackLevelView[] {
  const t = trackOf(season, track);
  const claimed = new Set(
    track === "premium" ? state.claimedPremium
      : track === "competitive" ? state.claimedCompetitive
      : state.claimedFree,
  );
  return Object.keys(t)
    .map(Number)
    .sort((a, b) => a - b)
    .map((level) => ({
      level,
      reward: t[level],
      claimed: claimed.has(level),
      claimable: open && level <= reached && !claimed.has(level),
    }));
}

/**
 * Progreso de logros calculado con datos del SERVIDOR.
 *
 * El catálogo (`ACHIEVEMENTS`) evalúa el progreso sobre un contexto de colección que se
 * arma en el navegador. Aquí solo se usan los logros cuyo progreso se puede derivar de
 * métricas de servidor; el resto se enseña con su progreso, pero el reclamo lo autoriza
 * siempre el servidor con su propia cuenta.
 */
function achievementViews(
  ctx: AchievementContext, claimed: Map<string, string | null>,
): AchievementView[] {
  return ACHIEVEMENTS.map((a) => {
    const current = serverProgressFor(a, ctx);
    return {
      id: a.id,
      name: a.name,
      description: a.description,
      icon: a.icon,
      reward: a.reward,
      goal: a.goal,
      current: Math.min(current, a.goal),
      complete: current >= a.goal,
      claimed: claimed.has(a.id),
      claimedAt: claimed.get(a.id) ?? null,
    };
  });
}

/**
 * Progreso de un logro medido SOLO con lo que el servidor sabe.
 *
 * Los logros de colección («completar Team Heretics») dependen de qué cartas concretas
 * se poseen, y esa evaluación vive en el catálogo del cliente. Para esos se devuelve el
 * número de cartas poseídas, que es una cota inferior honesta: el reclamo no se abrirá
 * antes de tiempo, y como mucho se abrirá tarde. Prefiero eso a conceder de más.
 */
/*
 * FASE 27 · Ahora se evalúa con la MISMA función del catálogo (`AchievementDef.progress`) sobre un
 * contexto armado con datos del servidor (`user_cards.card_id`, `profiles.packs_opened`). Antes
 * solo tres logros tenían progreso en servidor y los otros cuatro devolvían 0: eran inreclamables.
 */
function serverProgressFor(def: AchievementDef, ctx: AchievementContext): number {
  const n = def.progress(ctx);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

// ───────────────────────────── Operaciones ─────────────────────────────

/** Todo lo que la pantalla de progresión necesita, en una sola lectura. */
export async function getProgression(
  admin: SupabaseClient, userId: string,
): Promise<ServiceResult<ProgressionView>> {
  const now = Date.now();
  let state: PassState; let facts: PlayerFacts;
  try {
    ({ state, facts } = await ensurePass(admin, userId, now));
  } catch (e) {
    if (!(e instanceof PassConflictError)) throw e;
    const r = await resolveForUser(admin, userId, now);
    state = r.resolved.state; facts = r.facts;
  }
  return ok(composeView(state, facts.metrics, facts.ctx, await readViewParts(admin, userId), now));
}

interface ViewParts {
  profile: unknown;
  claimedRows: unknown;
  cosmeticRows: unknown;
}

async function readViewParts(admin: SupabaseClient, userId: string): Promise<ViewParts> {
  const [{ data: profile }, { data: claimedRows }, { data: cosmeticRows }] = await Promise.all([
    admin.from("profiles").select("equipped").eq("id", userId).maybeSingle(),
    admin.from("user_achievements").select("achievement_id, claimed_at").eq("user_id", userId),
    admin.from("user_cosmetics").select("cosmetic_id").eq("user_id", userId),
  ]);
  return { profile, claimedRows, cosmeticRows };
}

/** La vista del pase a partir de un estado ya leído. Pura: no lee ni escribe. */
function composeView(
  state: PassState, metrics: MetricSnapshot, ctx: AchievementContext, parts: ViewParts, now: number,
): ProgressionView {
  const { profile, claimedRows, cosmeticRows } = parts;
  const claimed = new Map(((claimedRows ?? []) as { achievement_id: string; claimed_at: string | null }[])
    .map((r) => [r.achievement_id, r.claimed_at ?? null]));
  const prog = levelProgress(state.xp, CURRENT_SEASON);

  return {
    serverNow: now,
    season: { id: CURRENT_SEASON.id, name: CURRENT_SEASON.name, maxLevel: CURRENT_SEASON.maxLevel },
    level: prog.level,
    xp: state.xp,
    xpIntoLevel: prog.xpIntoLevel,
    xpForNext: prog.xpForNext,
    progress: prog.progress,
    premium: state.premium,
    competitiveUnlocked: state.competitiveUnlocked,
    competitiveMinPoints: CURRENT_SEASON.competitiveMinPoints ?? 0,
    points: metrics.points ?? 0,
    equipped: ((profile as { equipped?: Record<string, string> } | null)?.equipped ?? {}),
    tracks: {
      free: trackView(CURRENT_SEASON, "free", state, prog.level, true),
      competitive: trackView(CURRENT_SEASON, "competitive", state, prog.level, state.competitiveUnlocked),
      premium: trackView(CURRENT_SEASON, "premium", state, prog.level, state.premium),
    },
    missions: missionViews(state.missions, metrics),
    achievements: achievementViews(ctx, claimed),
    cosmetics: ((cosmeticRows ?? []) as { cosmetic_id: string }[]).map((r) => r.cosmetic_id),
  };
}

/** Lo que `getProgression` HARÍA al leer y `peekProgression` no hace: se informa, no se ejecuta. */
export interface ProgressionPending {
  /** El jugador alcanza el umbral pero el carril competitivo aún no se ha persistido abierto. */
  competitiveUnlock: boolean;
  /** Hay una tanda diaria/semanal de una ventana anterior: se renovará al abrir Progresión/Logros. */
  missionRotation: boolean;
  /** Aún no tiene misiones asignadas (se asignan al abrir Progresión/Logros). */
  missionsUnassigned: boolean;
}

export interface ProgressionPeek {
  view: ProgressionView;
  state: PassState;
  metrics: MetricSnapshot;
  pending: ProgressionPending;
  /** Fase 40 · `card_id` distintos poseídos (de la MISMA lectura de `loadFacts`): preparación del primer equipo. */
  ownedCardIds: string[];
  /** FASE 62 · ejemplares (filas de `user_cards`, repetidas incluidas), de la MISMA lectura. */
  ownedInstances: number;
}

/**
 * FASE 34 · LA MISMA VISTA QUE `getProgression`, SIN ESCRIBIR NADA.
 *
 * `getProgression` persiste al leer dos cosas desde la Fase 9E/27: abrir el carril competitivo y
 * sortear/rotar misiones. La pantalla de temporada es una lectura pura (GET sin efectos: no puede
 * mutar el pase), así que usa esto: mismo `loadPass` (el avance de contenido es en memoria), mismas
 * métricas, misma composición (`composeView`), y lo que quedaría pendiente se DICE en `pending`.
 */
export async function peekProgression(
  admin: SupabaseClient, userId: string, now = Date.now(),
): Promise<ServiceResult<ProgressionPeek>> {
  // Fase 42 · el estado QUE CORRESPONDE a `now` (rotación determinista con baseline anclada), sin escribirlo.
  const r = await resolveForUser(admin, userId, now);
  const { metrics, ctx } = r.facts;
  const state = r.resolved.state;
  const pending: ProgressionPending = {
    competitiveUnlock: r.resolved.unlockedCompetitive,
    missionRotation: r.resolved.rotated.length > 0,
    missionsUnassigned: r.resolved.assigned,
  };
  const view = composeView(state, metrics, ctx, await readViewParts(admin, userId), now);
  return ok({ view, state, metrics, pending, ownedCardIds: [...ctx.ownedCardIds], ownedInstances: r.facts.cardRows.length });
}

function missionViews(missions: ActiveMission[], metrics: MetricSnapshot): PassMissionView[] {
  // Fase 42 · la misma vista pura que usa la simulación de retorno (`domain/progression/rotation`).
  return missionViewsOf(missions, metrics, CURRENT_SEASON.missionPool);
}

const PASS_CONFLICT = "Tu pase acaba de cambiar en otra pestaña. Vuelve a intentarlo.";

/**
 * FASE 62 · RECLAMOS ROBUSTOS A LA CONCURRENCIA. La QA real (dos «Reclamar todo» a la vez) encontró que un conflicto
 * optimista del pase (`savePass` → 409) dejaba el reclamo A MEDIAS: el pago ya estaba hecho (idempotente por su clave)
 * pero la misión no quedaba marcada ni sumaba su XP de temporada hasta que el jugador volviera a pulsar. Ahora el servicio
 * REINTENTA el reclamo entero (releer el pase, recalcular, pagar con la MISMA clave —el libro mayor no paga dos veces— y
 * guardar) hasta `CLAIM_ATTEMPTS` veces. Nada cambia en qué se paga ni cuánto.
 */
const CLAIM_ATTEMPTS = 3;
async function withPassRetry<T>(fn: () => Promise<ServiceResult<T>>): Promise<ServiceResult<T>> {
  let last: ServiceResult<T> | null = null;
  for (let i = 0; i < CLAIM_ATTEMPTS; i++) {
    try { return await fn(); } catch (e) {
      if (!(e instanceof PassConflictError)) throw e;
      last = fail(409, PASS_CONFLICT) as ServiceResult<T>;
    }
  }
  return last ?? (fail(409, PASS_CONFLICT) as ServiceResult<T>);
}

/** Reclama la recompensa de un nivel de un carril. */
export async function claimPassLevel(
  admin: SupabaseClient, userId: string, level: number, track: PassTrack,
): Promise<ServiceResult<{ rewards: Reward[] }>> {
  if (!Number.isInteger(level) || level < 1 || level > CURRENT_SEASON.maxLevel) {
    return fail(400, "Nivel no válido");
  }
  return withPassRetry(() => claimPassLevelOnce(admin, userId, level, track));
}

async function claimPassLevelOnce(
  admin: SupabaseClient, userId: string, level: number, track: PassTrack,
): Promise<ServiceResult<{ rewards: Reward[] }>> {
  let state: PassState; let version: string | null;
  // F62 · un conflicto (`PassConflictError`) sube a `withPassRetry`, que repite el reclamo entero.
  ({ state, version } = await ensurePass(admin, userId, Date.now()));
  const engine = new PassEngine(state, CURRENT_SEASON);
  const result = engine.claimReward(level, track, Date.now());
  if (!result.ok) return fail(409, result.error ?? "No se puede reclamar");

  // Primero se paga y después se marca. Al revés, un fallo al conceder dejaría el nivel
  // marcado como reclamado sin haber pagado nada.
  await grantRewards(admin, userId, result.rewards, `pass:${CURRENT_SEASON.id}:${track}:${level}`, "pass_reward");
  await savePass(admin, userId, result.state, version);
  return ok({ rewards: result.rewards });
}

/** Reclama una misión completada: paga su recompensa y suma su XP al pase. */
export async function claimMission(
  admin: SupabaseClient, userId: string, missionId: string,
): Promise<ServiceResult<{ rewards: Reward[] }>> {
  return withPassRetry(() => claimMissionOnce(admin, userId, missionId));
}

async function claimMissionOnce(
  admin: SupabaseClient, userId: string, missionId: string,
): Promise<ServiceResult<{ rewards: Reward[] }>> {
  // Fase 42 · primero se materializa la ventana vigente (determinista): se reclama sobre la tanda que se ve.
  let state: PassState; let version: string | null; let metrics: MetricSnapshot;
  // F62 · un conflicto sube a `withPassRetry`.
  ({ state, version, facts: { metrics } } = await ensurePass(admin, userId, Date.now()));
  const engine = new PassEngine(state, CURRENT_SEASON);
  const before = state.missions.find((m) => m.id === missionId);
  const result = engine.completeMission(missionId, metrics, Date.now());
  if (!result.ok || !before) return fail(409, result.error ?? "La misión no se puede reclamar");

  await grantRewards(
    admin, userId, result.rewards,
    /*
     * FASE 27 · CLAVE DETERMINISTA. Antes llevaba `Date.now()`: cada reintento de red era un pago
     * nuevo (no idempotente). Ahora la clave es la TANDA y el PUNTO DE PARTIDA de ese reclamo:
     * una misión repetible se reclama varias veces con baselines distintos (cada uno un pago), y
     * el mismo reclamo repetido —doble clic, reintento, dos peticiones a la vez— cae en la misma
     * clave y el libro mayor lo devuelve sin pagar dos veces.
     */
    `mission:${CURRENT_SEASON.id}:${missionId}:${before.assignedAt}:${before.baseline}`,
    "mission_reward",
  );
  // El pago ya es idempotente por su clave; si otra escritura ganó (conflicto), `withPassRetry` repite el reclamo
  // entero sobre el pase nuevo: la XP de temporada se suma UNA vez (la misión ya reclamada no se vuelve a completar).
  await savePass(admin, userId, result.state, version);
  return ok({ rewards: result.rewards });
}

/**
 * Reclama un logro. La comprobación de si está completo la hace el SERVIDOR con sus
 * propias métricas; lo que diga el cliente es irrelevante.
 */
export async function claimAchievement(
  admin: SupabaseClient, userId: string, achievementId: string,
): Promise<ServiceResult<{ credits: number }>> {
  const def = ACHIEVEMENTS.find((a) => a.id === achievementId);
  if (!def) return fail(404, "Ese logro no existe");

  const { data: already } = await admin.from("user_achievements")
    .select("achievement_id").eq("user_id", userId).eq("achievement_id", achievementId).maybeSingle();
  if (already) return fail(409, "Ya has reclamado este logro");

  const { ctx } = await loadFacts(admin, userId);
  if (serverProgressFor(def, ctx) < def.goal) {
    return fail(409, "Todavía no has completado este logro");
  }

  await grantRewards(admin, userId, [{ credits: def.reward }], `achievement:${achievementId}`, "achievement");
  const { error } = await admin.from("user_achievements")
    .insert({ user_id: userId, achievement_id: achievementId });
  // Una carrera entre dos peticiones simultáneas la corta la clave primaria; el pago ya
  // era idempotente por su `ref`, así que nadie cobra dos veces.
  if (error && !error.message.includes("duplicate")) throw new Error(error.message);

  return ok({ credits: def.reward });
}

/**
 * Equipa (o retira) un cosmético.
 *
 * Fase 11. Hasta ahora el carril de aspecto repartía quince cosméticos que se guardaban en
 * `user_cosmetics` y no se podían ver ni llevar en ninguna parte: un id en una tabla que
 * ninguna pantalla leía. Eso vacía de sentido al único carril que se pretende monetizar.
 *
 * La comprobación de propiedad la hace la RPC dentro de la misma transacción, no este
 * servicio: si se hiciera aquí, bastaría con llamar a la ruta con un id inventado.
 */
export async function equipCosmetic(
  admin: SupabaseClient, userId: string, family: string, cosmeticId: string | null,
): Promise<ServiceResult<{ equipped: Record<string, string> }>> {
  if (!/^[a-z]{1,24}$/.test(family)) return fail(400, "Familia no válida");
  if (cosmeticId !== null && !/^[a-z]+:[a-z0-9-]{1,48}$/.test(cosmeticId)) {
    return fail(400, "Cosmético no válido");
  }

  const { data, error } = await admin.rpc("app_equip_cosmetic", {
    p_user: userId, p_family: family, p_cosmetic_id: cosmeticId,
  });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("No tienes ese cosmético")) return fail(403, "No tienes ese cosmético");
    if (m.includes("no es de esa familia")) return fail(400, "Ese cosmético no es de esa familia");
    return fail(500, m || "No se pudo equipar");
  }
  return ok({ equipped: (data ?? {}) as Record<string, string> });
}

/**
 * «Actualizar misiones». FASE 41 · YA NO RE-SORTEA A DEMANDA: antes cada llamada tiraba la tanda entera y asignaba
 * misiones nuevas con baseline nuevo, así que «reclamar → actualizar → reclamar» cobraba la misma misión sin límite.
 * Ahora hace lo mismo que la lectura: asigna si no hay nada y rota SOLO los tipos cuya ventana ya terminó.
 */
export async function refreshMissions(
  admin: SupabaseClient, userId: string,
): Promise<ServiceResult<{ missions: PassMissionView[] }>> {
  const now = Date.now();
  let state: PassState; let facts: PlayerFacts;
  try { ({ state, facts } = await ensurePass(admin, userId, now)); } catch (e) {
    if (!(e instanceof PassConflictError)) throw e;
    const r = await resolveForUser(admin, userId, now);
    state = r.resolved.state; facts = r.facts;
  }
  return ok({ missions: missionViews(state.missions, facts.metrics) });
}

// Reexportado para que las pruebas puedan armar misiones sin duplicar la lógica.
export { assignMission, rollMissions };
