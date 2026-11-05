/**
 * TEMPORADA — SERVICIO DE LECTURA (Fase 34, SOLO SERVIDOR).
 *
 * Responde, con el reloj del SERVIDOR, a «¿qué temporada hay?» (`getSeasonCalendar`) y compone la foto del
 * Season Hub (`getSeasonHub`) a partir de lo que YA existe:
 *
 *   calendario        → `data/seasonCalendar` + `domain/season` (única fuente)
 *   pase / objetivos  → `peekProgression` (misma vista que `getProgression`, SIN escrituras)
 *   ranked            → `duel_pvp_ratings` + `duel_pvp_rating_events` (lectura; no se crea la ficha)
 *   eventos / Pick'em → `getEventsOverview` (Fase 30, lectura)
 *   acciones          → `seasonActions` → `todayActions` (la prioridad de la home)
 *   resumen           → `buildSeasonRecap` sobre hechos fechados
 *
 * GARANTÍAS: ninguna función de este módulo inserta, actualiza, borra ni llama RPC de escritura. Abrir
 * `/temporada` no concede, no resetea, no rota misiones y no toca rating ni créditos (lo prueba
 * `season.service.test.ts` contra una base de datos en memoria que registra cualquier escritura).
 * Lecturas acotadas: todas en paralelo, con `limit` o recuento, ninguna dentro de un bucle.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SEASON_CALENDAR } from "@/data/seasonCalendar";
import { CURRENT_SEASON } from "@/data/season";
import { TOTAL_CARDS } from "@/data/catalog";
import {
  resolveCalendar, findResolved, buildSeasonRecap, rankedRecap, seasonActions, SEASON_KEY,
  type CalendarPhase, type ResolvedSeason, type SeasonCalendarEntry, type SeasonRecap, type RankedRecap,
} from "@/domain/season";
import { accountLevel, sortObjectives, type MetaLevel, type MetaObjective, type TodayAction } from "@/domain/progression/meta";
import { isMissionAvailable } from "@/domain/progression/missionAvailability";
import { isProvisional } from "@/domain/cardgame/rating/types";
import type { Reward } from "@/battlepass";
import { peekProgression, type AchievementView, type PassTrackLevelView } from "./progression";
import { readCompetitivePosition } from "./competitive";
import { getEventsOverview, type EventCardView } from "./liveEvents";
import { listDecks } from "./duels";

export interface SeasonResult<T> { ok: boolean; status: number; error?: string; code?: string; data?: T }
const done = <T,>(data: T): SeasonResult<T> => ({ ok: true, status: 200, data });
const fail = (status: number, error: string, code?: string): SeasonResult<never> => ({ ok: false, status, error, code });

/**
 * ¿Se puede contar «cartas conseguidas esta temporada» con `user_cards.obtained_at`? NO, medido:
 *   · `app_buy_listing` (0020) reescribe `obtained_at` al comprar en el mercado;
 *   · las instancias subidas desde la colección local nacen con `default now()` (0011), la fecha de la
 *     sincronización, no la de la obtención;
 *   · lo vendido desaparece del inventario.
 * Una ventana sobre esa columna mezclaría las tres cosas. Se OMITE la métrica hasta que exista un
 * registro inmutable de adquisiciones (P2). El camino queda cableado tras esta bandera.
 */
export const COLLECTION_WINDOW_RELIABLE = false;

export function loadSeasonCalendar(): readonly SeasonCalendarEntry[] {
  return SEASON_CALENDAR;
}

/* ───────────────────────────── modelos de lectura ───────────────────────────── */

export type SeasonView = ResolvedSeason;

export interface SeasonCalendarSnapshot {
  serverNow: number;
  phase: CalendarPhase;
  current: SeasonView | null;
  next: SeasonView | null;
  previous: SeasonView | null;
  seasons: SeasonView[];
}

export interface SeasonEventLite {
  id: string; name: string; label: string; lifecycle: EventCardView["lifecycle"];
  startDate: string | null; endDate: string | null; liveCount: number; isDemo: boolean;
  /** Solo con sesión: predicciones abiertas / sin responder. */
  pickem: { open: number; pending: number } | null;
}

export interface SeasonPassView {
  seasonId: string;
  name: string;
  level: number;
  maxLevel: number;
  /** XP del PASE (lineal, 1.000 por nivel). No es la XP de cuenta. */
  xp: number;
  xpIntoLevel: number;
  xpForNext: number;
  progress: number;
  competitiveUnlocked: boolean;
  /** Alcanza el umbral pero el carril se abrirá (persistirá) al abrir Logros y pase. */
  competitiveUnlockPending: boolean;
  competitiveMinPoints: number;
  points: number;
  tracks: { free: PassTrackLevelView[]; competitive: PassTrackLevelView[] };
  claimable: { free: number; competitive: number };
  nextReward: { track: "free" | "competitive"; level: number; reward: Reward } | null;
}

export interface ObjectiveCount { done: number; total: number }

export interface SeasonPersonal {
  /** Nivel de CUENTA (`profiles.xp`, curva `levelFromXp`). Distinto del nivel del pase. */
  account: MetaLevel;
  pass: SeasonPassView | null;
  objectives: {
    daily: ObjectiveCount; weekly: ObjectiveCount; seasonal: ObjectiveCount; progressive: ObjectiveCount;
    list: MetaObjective[];
    /**
     * FASE 52 · TODAS las misiones de la tanda (también las reclamadas), para la sección Misiones del hub.
     * Ya filtradas por disponibilidad (sin Marketplace, ninguna de mercado). `list` sigue siendo el resumen.
     */
    all: MetaObjective[];
    claimable: number;
    /** Una tanda de una ventana anterior: se renueva al abrir Objetivos (esta lectura no la rota). */
    rotationPending: boolean;
    unassigned: boolean;
  } | null;
  achievements: { total: number; complete: number; claimed: number; claimable: number; highlights: AchievementView[] };
  competitive: {
    rating: number; gamesPlayed: number; wins: number; losses: number; draws: number; provisional: boolean;
    position: number | null; rankedTotal: number;
    inSeason: RankedRecap;
    recent: { at: number; result: "WIN" | "LOSS" | "DRAW"; delta: number; newRating: number }[];
  } | null;
  pickems: { pending: number; inSeason: { scored: number; points: number; correct: number } } | null;
  collection: { distinct: number; owned: number; catalog: number; obtainedInSeason: number | null; windowReliable: boolean };
  actions: TodayAction[];
  recap: SeasonRecap;
}

export interface SeasonHubSnapshot {
  serverNow: number;
  calendar: SeasonCalendarSnapshot;
  season: SeasonView;
  isCurrent: boolean;
  events: { available: boolean; live: SeasonEventLite[]; upcoming: SeasonEventLite[]; inWindow: SeasonEventLite[] };
  /** `null` sin sesión: nada personal viaja a un visitante. */
  personal: SeasonPersonal | null;
}

/* ───────────────────────────── calendario ───────────────────────────── */

export function getSeasonCalendar(now = Date.now(), entries: readonly SeasonCalendarEntry[] = loadSeasonCalendar()): SeasonResult<SeasonCalendarSnapshot> {
  const r = resolveCalendar(entries, now);
  if (!r.ok) {
    console.error("[season] calendario inválido", JSON.stringify(r.issues));
    return fail(500, "Calendario de temporadas no válido", "INVALID_CALENDAR");
  }
  return done({ serverNow: now, phase: r.phase, current: r.current, next: r.next, previous: r.previous, seasons: r.seasons });
}

/* ───────────────────────────── hub ───────────────────────────── */

const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

const lite = (e: EventCardView): SeasonEventLite => ({
  id: e.id, name: e.name, label: e.label, lifecycle: e.lifecycle, startDate: e.startDate, endDate: e.endDate,
  liveCount: e.liveCount, isDemo: e.isDemo, pickem: e.pickem,
});

/** ¿Las fechas del evento tocan la ventana? Solo para el calendario: no hay FK evento→temporada. */
function touchesWindow(e: EventCardView, s: ResolvedSeason): boolean {
  const start = msOf(e.startDate); const end = msOf(e.endDate);
  const a = Number.isFinite(start) ? start : end; const b = Number.isFinite(end) ? end + 86_400_000 : a;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a < s.endsAtMs && b > s.startsAtMs;
}

const count = (list: MetaObjective[], kind: string): ObjectiveCount => {
  const l = list.filter((o) => o.kind === kind);
  return { done: l.filter((o) => o.complete || o.claimed).length, total: l.length };
};

export async function getSeasonHub(
  sb: SupabaseClient, userId: string | null, opts: { season?: string | null; now?: number; entries?: readonly SeasonCalendarEntry[] } = {},
): Promise<SeasonResult<SeasonHubSnapshot>> {
  const now = opts.now ?? Date.now();
  const cal = getSeasonCalendar(now, opts.entries ?? loadSeasonCalendar());
  if (!cal.ok || !cal.data) return fail(cal.status, cal.error ?? "Calendario no disponible", cal.code);
  const calendar = cal.data;

  let season: ResolvedSeason | null;
  if (opts.season) {
    if (!SEASON_KEY.test(opts.season)) return fail(400, "Temporada no válida", "INVALID_SEASON");
    season = findResolved(calendar.seasons, opts.season);
    if (!season) return fail(404, "Temporada no encontrada", "SEASON_NOT_FOUND");
  } else {
    season = calendar.current ?? calendar.next ?? calendar.previous;
    if (!season) return fail(404, "No hay ninguna temporada configurada", "NO_SEASONS");
  }
  const isCurrent = calendar.current?.id === season.id;

  try {
    const overview = await getEventsOverview(sb, userId, { now });
    const ev = overview.ok && overview.data ? overview.data : null;
    const all = ev ? [...ev.active, ...ev.upcoming, ...ev.completed] : [];
    const events = {
      available: !!ev,
      live: (ev?.active ?? []).filter((e) => e.liveCount > 0).map(lite),
      upcoming: (ev?.upcoming ?? []).slice(0, 3).map(lite),
      inWindow: all.filter((e) => touchesWindow(e, season!)).slice(0, 8).map(lite),
    };

    const personal = userId ? await readPersonal(sb, userId, season, isCurrent, ev?.active ?? [], ev?.upcoming ?? [], now) : null;
    return done({ serverNow: now, calendar, season, isCurrent, events, personal });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer la temporada");
  }
}

async function readPersonal(
  sb: SupabaseClient, userId: string, season: ResolvedSeason, isCurrent: boolean,
  activeEvents: EventCardView[], upcomingEvents: EventCardView[], now: number,
): Promise<SeasonPersonal> {
  const start = iso(season.startsAtMs); const end = iso(season.endsAtMs);
  const [peek, profile, position, windowEvents, recentEvents, scores, packs, activeDuel, decks, obtained] = await Promise.all([
    peekProgression(sb, userId, now),
    sb.from("profiles").select("xp").eq("id", userId).maybeSingle(),
    readCompetitivePosition(sb, userId),
    sb.from("duel_pvp_rating_events").select("created_at, result, old_rating, new_rating")
      .eq("user_id", userId).gte("created_at", start).lt("created_at", end).order("created_at", { ascending: true }).limit(500),
    sb.from("duel_pvp_rating_events").select("created_at, result, delta, new_rating")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(5),
    sb.from("pickem_scores").select("points, correct, total, scored_at")
      .eq("user_id", userId).gte("scored_at", start).lt("scored_at", end).limit(200),
    sb.from("user_packs").select("qty").eq("user_id", userId).gt("qty", 0).limit(200),
    sb.from("duel_matches").select("id").eq("user_id", userId).eq("mode", "PVE").eq("status", "IN_PROGRESS").limit(1).maybeSingle(),
    listDecks(sb, userId),
    COLLECTION_WINDOW_RELIABLE
      ? sb.from("user_cards").select("uid", { count: "exact", head: true }).eq("user_id", userId).gte("obtained_at", start).lt("obtained_at", end)
      : Promise.resolve(null),
  ]);
  if (!peek.ok || !peek.data) throw new Error(peek.error ?? "No se pudo leer el pase");
  const { view, state, metrics, pending } = peek.data;

  const xp = (profile.data as { xp?: number } | null)?.xp ?? 0;
  const account = accountLevel(xp);

  // ── Pase de ESTA temporada (vivo o archivado): solo si su contenido es el de la temporada.
  const livePass = season.passSeasonId !== null && season.passSeasonId === state.seasonId && state.seasonId === CURRENT_SEASON.id;
  const archived = season.passSeasonId ? state.archive.find((a) => a.seasonId === season.passSeasonId) ?? null : null;

  let pass: SeasonPassView | null = null;
  if (livePass) {
    const free = view.tracks.free; const competitive = view.tracks.competitive;
    const next = [...free.map((l) => ({ track: "free" as const, l })), ...competitive.map((l) => ({ track: "competitive" as const, l }))]
      .filter((x) => !x.l.claimed && x.l.level > view.level)
      .sort((a, b) => a.l.level - b.l.level)[0];
    pass = {
      seasonId: view.season.id, name: view.season.name, level: view.level, maxLevel: view.season.maxLevel,
      xp: view.xp, xpIntoLevel: view.xpIntoLevel, xpForNext: view.xpForNext, progress: view.progress,
      competitiveUnlocked: view.competitiveUnlocked, competitiveUnlockPending: pending.competitiveUnlock,
      competitiveMinPoints: view.competitiveMinPoints, points: view.points,
      tracks: { free, competitive },
      claimable: { free: free.filter((l) => l.claimable).length, competitive: competitive.filter((l) => l.claimable).length },
      nextReward: next ? { track: next.track, level: next.l.level, reward: next.l.reward } : null,
    };
  }

  /*
   * FASE 52 · Defensa en la LECTURA: una misión que pide el Marketplace no se enseña con él cerrado aunque
   * estuviera asignada de antes (el sorteo ya las excluye; esto cubre estados antiguos).
   */
  const objectivesList = sortObjectives(view.missions as MetaObjective[]).filter((o) => isMissionAvailable(o));
  const objectives = livePass ? {
    daily: count(objectivesList, "daily"), weekly: count(objectivesList, "weekly"),
    seasonal: count(objectivesList, "seasonal"), progressive: count(objectivesList, "progressive"),
    list: objectivesList.filter((o) => !o.claimed).slice(0, 6),
    all: objectivesList,
    claimable: objectivesList.filter((o) => o.complete && !o.claimed).length,
    rotationPending: pending.missionRotation, unassigned: pending.missionsUnassigned,
  } : null;

  const ach = view.achievements;
  const achievements = {
    total: ach.length,
    complete: ach.filter((a) => a.complete).length,
    claimed: ach.filter((a) => a.claimed).length,
    claimable: ach.filter((a) => a.complete && !a.claimed).length,
    highlights: [...ach].sort((a, b) =>
      Number(b.complete && !b.claimed) - Number(a.complete && !a.claimed) || Number(a.claimed) - Number(b.claimed) || (b.current / b.goal) - (a.current / a.goal)).slice(0, 4),
  };

  // ── Ranked: fila persistente (NO se reinicia) + asientos dentro de la ventana.
  const ratingEvents = ((windowEvents.data ?? []) as { created_at: string; result: "WIN" | "LOSS" | "DRAW"; old_rating: number; new_rating: number }[])
    .map((r) => ({ createdAt: Date.parse(r.created_at), result: r.result, oldRating: r.old_rating, newRating: r.new_rating }));
  const row = position.ok && position.data ? position.data.row : null;
  const inSeason = rankedRecap(ratingEvents, season.startsAtMs, season.endsAtMs) ?? { games: 0, wins: 0, losses: 0, draws: 0, startRating: null, finalRating: null, highestRating: null };
  const competitive = row ? {
    rating: row.rating, gamesPlayed: row.games_played, wins: row.wins, losses: row.losses, draws: row.draws,
    provisional: isProvisional(row.games_played),
    position: position.data!.position, rankedTotal: position.data!.rankedTotal,
    inSeason,
    recent: ((recentEvents.data ?? []) as { created_at: string; result: "WIN" | "LOSS" | "DRAW"; delta: number; new_rating: number }[])
      .map((r) => ({ at: Date.parse(r.created_at), result: r.result, delta: r.delta, newRating: r.new_rating })),
  } : null;

  // ── Pick'ems: pendientes (eventos abiertos) y puntuados en la ventana. Nunca respuestas.
  const pendingPicks = [...activeEvents, ...upcomingEvents].reduce((s, e) => s + (e.pickem?.pending ?? 0), 0);
  const pickemScores = ((scores.data ?? []) as { points: number; correct: number; total: number; scored_at: string }[])
    .map((p) => ({ scoredAt: Date.parse(p.scored_at), points: p.points, correct: p.correct, total: p.total }));
  const pickems = {
    pending: pendingPicks,
    inSeason: { scored: pickemScores.length, points: pickemScores.reduce((s, p) => s + p.points, 0), correct: pickemScores.reduce((s, p) => s + p.correct, 0) },
  };

  const obtainedInSeason = COLLECTION_WINDOW_RELIABLE && obtained ? (obtained as { count: number | null }).count ?? null : null;
  const collection = { distinct: metrics.distinct_cards ?? 0, owned: metrics.owned_cards ?? 0, catalog: TOTAL_CARDS, obtainedInSeason, windowReliable: COLLECTION_WINDOW_RELIABLE };

  const unopened = ((packs.data ?? []) as { qty: number }[]).reduce((s, r) => s + r.qty, 0);
  const deckList = decks.ok ? decks.data?.decks ?? [] : null;
  const liveEvent = activeEvents.find((e) => e.liveCount > 0) ?? null;
  const actions = isCurrent ? seasonActions({
    activeDuel: !!activeDuel.data,
    claimable: {
      levels: (pass?.claimable.free ?? 0) + (pass?.claimable.competitive ?? 0),
      missions: objectives?.claimable ?? 0,
      achievements: achievements.claimable,
    },
    pendingPicks,
    unopenedPacks: unopened,
    hasValidDeck: deckList ? deckList.some((d) => d.valid) : null,
    objectives: objectivesList,
    rankedGames: inSeason.games,
    liveEvent: liveEvent ? { id: liveEvent.id, name: liveEvent.name } : null,
  }) : [];

  const recap = buildSeasonRecap({
    season: { id: season.id, name: season.name, startsAtMs: season.startsAtMs, endsAtMs: season.endsAtMs, status: season.status },
    pass: livePass
      ? { level: view.level, maxLevel: view.season.maxLevel, xp: view.xp, missionsCompleted: state.missionsCompleted, claimedFree: state.claimedFree.length, claimedCompetitive: state.claimedCompetitive.length, source: "LIVE" }
      : archived
        ? { level: archived.level, maxLevel: null, xp: archived.xp, missionsCompleted: archived.missionsCompleted, claimedFree: archived.claimedFree, claimedCompetitive: archived.claimedCompetitive, source: "ARCHIVE" }
        : null,
    ratingEvents,
    achievementClaims: ach.map((a) => (a.claimedAt ? Date.parse(a.claimedAt) : NaN)).filter(Number.isFinite),
    pickemScores,
    cardsObtainedInWindow: obtainedInSeason,
  });

  return {
    account,
    pass: isCurrent ? pass : null,
    objectives: isCurrent ? objectives : null,
    achievements, competitive, pickems: isCurrent || pickemScores.length > 0 ? pickems : null, collection, actions, recap,
  };
}
