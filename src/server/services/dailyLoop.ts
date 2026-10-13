/**
 * DAILY GAME LOOP 2.0 — SERVICIO DE LECTURA (Fase 36, SOLO SERVIDOR).
 *
 * Reúne los HECHOS del vestíbulo y se los da al dominio puro (`buildDailyLoop`), que decide la acción
 * principal con la prioridad única de la home (`orderToday`). No es autoridad de nada.
 *
 * ────────────────────────── GARANTÍA: CERO ESCRITURAS ──────────────────────────
 *
 * Cada lectura es PURA. Donde el camino antiguo escribía, aquí se usa su equivalente de solo lectura:
 *
 *   pase / objetivos / logros → `peekProgression`   (NO `getProgression`: no rota misiones ni abre carril)
 *   ranked                    → `readCompetitivePosition` (NO `ensureRating`: no crea la ficha 1000/0)
 *   campaña                   → `readCampaignSummary` (una consulta; no crea `campaign_progress`)
 *   equipos / activo          → `listDecks` + `readActive` (no crea `duel_active_deck`)
 *   eventos / Pick'ems        → `getEventsOverview` (Fase 30; nunca respuestas, solo recuentos)
 *   temporada                 → `getSeasonCalendar` (código + reloj del servidor)
 *   primera sesión (Fase 40)  → derivada de lo anterior (cartas de `peekProgression`, sobres, equipos) + catálogo del
 *                               servidor; y `draft_runs` en combate (solo lectura) para «Continuar partida»
 *
 * Lo prueba `dailyLoop.service.test.ts` con un Supabase falso que registra cualquier insert/update/
 * upsert/delete/RPC.
 *
 * ────────────────────────── AISLAMIENTO ──────────────────────────
 *
 * Cada subsistema va en su propia guarda con tiempo máximo (`SUBSYSTEM_TIMEOUT_MS`). Si falla o tarda,
 * su hecho vale `null`: el bloque se degrada y el dominio no recomienda nada suyo. El vestíbulo nunca
 * espera a los reintentos de un servicio caído (el patrón de ~20 s de la Fase 34).
 *
 * Lecturas acotadas: todo en paralelo, con `limit`/`maybeSingle`, ninguna dentro de un bucle.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { TOTAL_CARDS } from "@/data/catalog";
import { ROAD_TO_CHAMPIONS } from "@/data/roadToChampions";
import { findNode } from "@/domain/campaign/definition";
import { accountLevel, type MetaObjective } from "@/domain/progression/meta";
import { isProvisional } from "@/domain/cardgame/rating/types";
import { packLabel } from "@/domain/pickems/ledger";
import { pendingBracketPicks } from "@/server/services/pickemBrackets";
import type { ResolvedSeason } from "@/domain/season/calendar";
import type { SeasonCalendarEntry } from "@/domain/season/calendar";
import { deckReadiness, firstPackOf, type JourneyFacts } from "@/domain/journey";
import { buildOnboarding, NO_FLAGS, type OnboardingFlags } from "@/domain/onboarding";
import { serverCatalog } from "@/server/catalog";
import {
  buildDailyLoop, rewardLabel,
  type ActiveMatchFact, type DailyLoopFacts, type DailyLoopSnapshot, type DailySubsystem, type DeckFact,
  type Difficulty, type LiveEventFact, type SeasonFact, ledgerRecent, packDisplayName,
} from "@/domain/dailyLoop";
import type { RecentFact } from "@/domain/liveService";
import type { DuelDeckDTO } from "@/lib/duel/types";
import { peekProgression } from "./progression";
import { readCompetitivePosition } from "./competitive";
import { readCampaignSummary } from "./campaign";
import { listDecks } from "./duels";
import { readActive } from "./deckTeams";
import { getEventsOverview, type EventCardView } from "./liveEvents";
import { getSeasonCalendar, loadSeasonCalendar } from "./season";

export type { DailyLoopSnapshot };

export interface DailyLoopResult { ok: boolean; status: number; error?: string; code?: string; data?: DailyLoopSnapshot }

/** Lo que puede tardar un subsistema antes de degradarse. Un vestíbulo no espera más. */
export const SUBSYSTEM_TIMEOUT_MS = 4_000;
/** Eventos que viajan en la foto (el destacado y el próximo salen de aquí). */
export const LIVE_EVENTS_MAX = 6;
/** Retos recibidos que se cuentan (el mismo tope que el contador de la navegación). */
export const CHALLENGES_MAX = 20;

export interface DailyLoopOptions {
  now?: number;
  timeoutMs?: number;
  entries?: readonly SeasonCalendarEntry[];
  /** Fase 63 · acuses del onboarding (de `app_metadata`, los pasa la ruta desde la sesión). Sin ellos: ninguno. */
  onboardingFlags?: OnboardingFlags;
}

type PgResult = { data: unknown; error: { message: string } | null };

async function must<T>(q: PromiseLike<PgResult>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as T;
}

/** Ejecuta `work` con tiempo máximo. Falla o tarda → `null` (y se anota el subsistema, sin detalles internos). */
async function guard<T>(name: DailySubsystem, work: () => Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("TIMEOUT")), ms); }),
    ]);
  } catch (e) {
    console.warn("[daily-loop]", name, e instanceof Error && e.message === "TIMEOUT" ? "timeout" : "unavailable");
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const seasonFact = (s: ResolvedSeason | null): SeasonFact | null => s
  ? { id: s.id, name: s.name, status: s.status, presentation: s.presentation, startsAtMs: s.startsAtMs, endsAtMs: s.endsAtMs }
  : null;

const eventFact = (e: EventCardView, signedIn: boolean): LiveEventFact => ({
  id: e.id, name: e.name, lifecycle: e.lifecycle, isDemo: e.isDemo, startDate: e.startDate, endDate: e.endDate,
  liveCount: e.liveCount,
  liveMatch: e.liveMatch ? { teamA: e.liveMatch.teamA, teamB: e.liveMatch.teamB, scoreA: e.liveMatch.scoreA, scoreB: e.liveMatch.scoreB } : null,
  nextMatch: e.nextMatch ? { teamA: e.nextMatch.teamA, teamB: e.nextMatch.teamB, startTime: e.nextMatch.startTime } : null,
  pickem: signedIn && e.pickem ? { open: e.pickem.open, pending: e.pickem.pending } : null,
});

const DIFFICULTIES = new Set(["EASY", "NORMAL", "HARD"]);

export async function getDailyLoop(sb: SupabaseClient, userId: string | null, opts: DailyLoopOptions = {}): Promise<DailyLoopResult> {
  const now = opts.now ?? Date.now();
  const ms = opts.timeoutMs ?? SUBSYSTEM_TIMEOUT_MS;
  try {
    const cal = getSeasonCalendar(now, opts.entries ?? loadSeasonCalendar());
    const calendar = cal.ok && cal.data ? cal.data : null;
    const season: DailyLoopFacts["season"] = calendar ? { current: seasonFact(calendar.current), next: seasonFact(calendar.next) } : null;

    const overviewP = guard("live", async () => {
      const r = await getEventsOverview(sb, userId, { now });
      if (!r.ok || !r.data) throw new Error("overview");
      return r.data;
    }, ms);

    if (!userId) {
      const overview = await overviewP;
      const live = overview ? [...overview.active, ...overview.upcoming, ...overview.completed.slice(0, 1)].slice(0, LIVE_EVENTS_MAX).map((e) => eventFact(e, false)) : null;
      return { ok: true, status: 200, data: buildDailyLoop(anonymousFacts(now, live, season)) };
    }

    const [overview, progression, competitive, campaign, decks, packs, matchRead, social, activity] = await Promise.all([
      overviewP,
      guard("progression", async () => {
        const [peek, profile] = await Promise.all([
          peekProgression(sb, userId, now),
          must<{ xp: number } | null>(sb.from("profiles").select("xp").eq("id", userId).maybeSingle()),
        ]);
        if (!peek.ok || !peek.data) throw new Error("peek");
        return { ...peek.data, xp: profile?.xp ?? 0 };
      }, ms),
      guard("competitive", async () => {
        const [pos, recent] = await Promise.all([
          readCompetitivePosition(sb, userId),
          must<{ result: "WIN" | "LOSS" | "DRAW" }[] | null>(sb.from("duel_pvp_rating_events").select("result, created_at")
            .eq("user_id", userId).order("created_at", { ascending: false }).limit(5)),
        ]);
        if (!pos.ok || !pos.data) throw new Error("position");
        return { ...pos.data, recent: (recent ?? []).map((r) => r.result) };
      }, ms),
      guard("campaign", async () => {
        const s = await readCampaignSummary(sb, userId);
        if (!s) throw new Error("campaign");
        return s;
      }, ms),
      guard("decks", async () => {
        const [list, active] = await Promise.all([
          listDecks(sb, userId),
          readActive(sb, userId).catch(() => ({ supported: false, deckId: null as string | null })),
        ]);
        if (!list.ok || !list.data) throw new Error("decks");
        return { decks: list.data.decks, activeId: active.deckId };
      }, ms),
      guard("packs", async () => {
        const rows = await must<{ pack_id: string; qty: number }[] | null>(sb.from("user_packs").select("pack_id, qty").eq("user_id", userId).gt("qty", 0).limit(200));
        const owned = (rows ?? []).map((r) => ({ packId: r.pack_id, qty: r.qty }));
        return { unopened: owned.reduce((s, r) => s + r.qty, 0), firstPackId: firstPackOf(owned), owned };
      }, ms),
      guard("match", () => readActiveMatches(sb, userId), ms),
      guard("social", () => readIncomingChallenges(sb, userId, now), ms),
      // Fase 42 · actividad real reciente: solo lecturas acotadas.
      guard("progression", () => readActivity(sb, userId), ms),
    ]);

    // F87 · picks de cuadro (Pick'ems 2.0) pendientes: lectura acotada, sin escrituras. Sin cuadros publicados = una consulta.
    const bracketPending = await guard("pickems", () => pendingBracketPicks(sb, userId, now), ms);
    const journey = progression && packs && decks ? await journeyFacts(sb, progression, packs, decks).catch((e: unknown) => {
      console.warn("[daily-loop]", "journey", e instanceof Error ? e.message : "unavailable");
      return null;
    }) : null;
    const facts: DailyLoopFacts = {
      now, signedIn: true, catalogSize: TOTAL_CARDS, season,
      matches: matchRead ? matchRead.matches : null,
      social,
      draftRun: matchRead ? matchRead.draftRun : undefined,
      activity,
      progression: progression ? progressionFacts(progression, calendar?.current ?? null) : null,
      pickems: withBracketPicks(overview ? pickemFacts([...overview.active, ...overview.upcoming]) : null, bracketPending),
      packs: packs === null ? null : { unopened: packs.unopened },
      decks: decks ? deckFacts(decks.decks, decks.activeId) : null,
      journey,
      campaign,
      competitive: competitive ? {
        rating: competitive.row?.rating ?? null,
        gamesPlayed: competitive.row?.games_played ?? 0,
        wins: competitive.row?.wins ?? 0,
        losses: competitive.row?.losses ?? 0,
        draws: competitive.row?.draws ?? 0,
        provisional: isProvisional(competitive.row?.games_played ?? 0),
        position: competitive.position,
        rankedTotal: competitive.rankedTotal,
        recent: competitive.recent,
      } : null,
      live: overview ? [...overview.active, ...overview.upcoming, ...overview.completed.slice(0, 1)].slice(0, LIVE_EVENTS_MAX).map((e) => eventFact(e, true)) : null,
    };
    // Fase 63 · la guía de la primera sesión, sobre los MISMOS hechos del recorrido (cero lecturas nuevas). Sin saldo:
    // la foto del vestíbulo no lleva créditos (contrato de privacidad de F36); la portada los toma del estado del juego.
    const onboarding = journey && progression && packs ? buildOnboarding({
      journey,
      flags: opts.onboardingFlags ?? NO_FLAGS,
      starter: { packs: [...packs.owned].sort((a, b) => (a.packId < b.packId ? -1 : a.packId > b.packId ? 1 : 0)) },
    }) : null;
    return { ok: true, status: 200, data: { ...buildDailyLoop(facts), onboarding } };
  } catch (e) {
    console.error("[daily-loop]", e instanceof Error ? e.message : e);
    return { ok: false, status: 500, error: "No se pudo leer tu sesión de juego", code: "UNAVAILABLE" };
  }
}

/**
 * Fase 40 · hechos del recorrido de la primera sesión. Sin lecturas nuevas de tablas: cartas (de `peekProgression`),
 * sobres y equipos ya leídos; el catálogo del servidor está en caché (lo cargó `listDecks`). Partidas terminadas =
 * la métrica `duels_played` (excluye Draft Gauntlet).
 */
async function journeyFacts(
  sb: SupabaseClient, p: Peek, packs: { unopened: number; firstPackId: string | null }, decks: { decks: DuelDeckDTO[]; activeId: string | null },
): Promise<JourneyFacts> {
  const reg = (await serverCatalog(sb)).registry;
  const readiness = deckReadiness(p.ownedCardIds, (id) => {
    const c = reg.card(id);
    const pl = c ? reg.player(c.playerId) : undefined;
    return c && pl ? { playerId: c.playerId, role: c.role ?? pl.role, dataVersion: c.dataVersion ?? "", combat: !!c.combat } : null;
  });
  const valid = decks.decks.filter((d) => d.valid);
  const ready = valid.find((d) => d.id === decks.activeId) ?? valid[0] ?? null;
  const invalid = decks.decks.find((d) => !d.valid) ?? null;
  return {
    ownedCards: p.metrics.owned_cards ?? 0,
    packsOpened: p.metrics.packs_opened ?? 0,
    matchesCompleted: p.metrics.duels_played ?? 0,
    unopenedPacks: packs.unopened,
    firstPackId: packs.firstPackId,
    decks: { total: decks.decks.length, valid: valid.length, firstInvalid: invalid ? { id: invalid.id, name: invalid.name, size: invalid.cards.length } : null },
    readyDeck: ready ? { id: ready.id, name: ready.name, cardIds: ready.cards.map((c) => c.cardId), active: ready.id === decks.activeId } : null,
    readiness,
  };
}

function anonymousFacts(now: number, live: LiveEventFact[] | null, season: DailyLoopFacts["season"]): DailyLoopFacts {
  return {
    now, signedIn: false, catalogSize: TOTAL_CARDS, season, live,
    matches: null, social: null, progression: null, pickems: null, packs: null, decks: null, campaign: null, competitive: null,
  };
}

type Peek = NonNullable<Awaited<ReturnType<typeof peekProgression>>["data"]> & { xp: number };

function progressionFacts(p: Peek, current: ResolvedSeason | null): NonNullable<DailyLoopFacts["progression"]> {
  const { view, metrics, pending } = p;
  const tracks = view.tracks;
  const claimableLevels = (["free", "competitive", "premium"] as const).reduce((n, t) => n + (tracks[t] ?? []).filter((l) => l.claimable).length, 0);
  const passLive = !!current && current.passSeasonId !== null && current.passSeasonId === view.season.id;
  const next = [...tracks.free.map((l) => ({ track: "free" as const, l })), ...tracks.competitive.map((l) => ({ track: "competitive" as const, l }))]
    .filter((x) => !x.l.claimed && x.l.level > view.level)
    .sort((a, b) => a.l.level - b.l.level || (a.track === b.track ? 0 : a.track === "free" ? -1 : 1))[0];
  const ach = view.achievements;
  const nearAch = ach
    .filter((a) => !a.complete && !a.claimed && a.goal > 0 && a.current > 0 && a.current / a.goal >= 0.5)
    .sort((a, b) => b.current / b.goal - a.current / a.goal || a.id.localeCompare(b.id))[0] ?? null;
  const lvl = accountLevel(p.xp);
  return {
    account: { level: lvl.level, xp: lvl.xp, xpIntoLevel: lvl.xpIntoLevel, xpForNext: lvl.xpForNext, progress: lvl.progress },
    pass: passLive ? {
      level: view.level, maxLevel: view.season.maxLevel, xp: view.xp, xpIntoLevel: view.xpIntoLevel, xpForNext: view.xpForNext, progress: view.progress,
      nextReward: next ? { level: next.l.level, track: next.track, label: rewardLabel(next.l.reward as Record<string, unknown>, packLabel) } : null,
    } : null,
    claimableLevels,
    objectives: view.missions as MetaObjective[],
    achievements: {
      total: ach.length,
      claimed: ach.filter((a) => a.claimed).length,
      claimable: ach.filter((a) => a.complete && !a.claimed).length,
      near: nearAch ? { id: nearAch.id, name: nearAch.name, current: nearAch.current, goal: nearAch.goal } : null,
    },
    rotationPending: pending.missionRotation,
    metrics: {
      ownedCards: metrics.owned_cards ?? 0,
      distinctCards: metrics.distinct_cards ?? 0,
      packsOpened: metrics.packs_opened ?? 0,
      duelsPlayed: metrics.duels_played ?? 0,
    },
  };
}

/** F87 · suma los picks de cuadro pendientes al hecho de Pick'ems (sin ellos, el hecho queda EXACTAMENTE igual). */
function withBracketPicks(base: DailyLoopFacts["pickems"], b: Awaited<ReturnType<typeof pendingBracketPicks>> | null): DailyLoopFacts["pickems"] {
  if (!b || b.pending <= 0) return base;
  const v1 = base ?? { pending: 0, open: 0, eventId: null, eventName: null, nextLockAt: null };
  const locks = [v1.nextLockAt ?? null, b.nextLockAt].filter((x): x is number => x !== null);
  return {
    pending: v1.pending + b.pending,
    open: v1.open + b.pending,
    eventId: v1.pending > 0 ? v1.eventId : null,
    eventName: v1.pending > 0 ? v1.eventName : b.title,
    nextLockAt: locks.length ? Math.min(...locks) : null,
  };
}

function pickemFacts(events: EventCardView[]): NonNullable<DailyLoopFacts["pickems"]> {
  const first = events.find((e) => (e.pickem?.pending ?? 0) > 0) ?? null;
  return {
    pending: events.reduce((s, e) => s + (e.pickem?.pending ?? 0), 0),
    open: events.reduce((s, e) => s + (e.pickem?.open ?? 0), 0),
    eventId: first?.id ?? null,
    eventName: first?.name ?? null,
    // Fase 42 · el cierre REAL más próximo de una predicción pendiente del usuario (solo la hora, nunca respuestas).
    nextLockAt: events.map((e) => e.pickem?.nextLockAt ?? null).filter((x): x is number => x !== null).reduce<number | null>((m, x) => (m === null || x < m ? x : m), null),
  };
}

/**
 * Fase 42 · ÚLTIMA ACTIVIDAD REAL y progreso reciente. Marcas del SERVIDOR: asientos del libro mayor, aperturas de
 * sobres (`economy_ops`), la última partida y la presencia (`last_seen_at`). Cuatro lecturas `limit`, ninguna en bucle.
 * No se usa `obtained_at` de la colección. No escribe (visitar el vestíbulo no es «actividad»).
 */
async function readActivity(sb: SupabaseClient, userId: string): Promise<{ lastActivityAt: number | null; recent: RecentFact[] }> {
  const [ledger, open, match, profile] = await Promise.all([
    must<{ reason: string; delta: number; created_at: string }[] | null>(sb.from("credit_transactions").select("reason, delta, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(5)),
    must<{ result: { packId?: string } | null; created_at: string } | null>(sb.from("economy_ops").select("result, created_at").eq("user_id", userId).eq("kind", "open_pack").order("created_at", { ascending: false }).limit(1).maybeSingle()),
    must<{ updated_at: string } | null>(sb.from("duel_matches").select("updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle()),
    must<{ last_seen_at: string | null } | null>(sb.from("profiles").select("last_seen_at").eq("id", userId).maybeSingle()),
  ]);
  const stamps = [ledger?.[0]?.created_at, open?.created_at, match?.updated_at, profile?.last_seen_at].map((s) => (s ? Date.parse(s) : NaN)).filter((x) => Number.isFinite(x));
  const recent: RecentFact[] = (ledger ?? []).map((r, i) => ledgerRecent({ reason: String(r.reason), delta: Number(r.delta), created_at: r.created_at }, i, packDisplayName)).filter((x): x is RecentFact => x !== null);
  if (open && Number.isFinite(Date.parse(open.created_at))) recent.push({ id: "open", label: `Abriste un ${packDisplayName(String(open.result?.packId ?? "sobre"))}`, at: Date.parse(open.created_at) });
  return { lastActivityAt: stamps.length ? Math.max(...stamps) : null, recent };
}

function deckFacts(decks: { id: string; name: string; valid: boolean; cards: unknown[]; sumOvr: number }[], activeId: string | null): NonNullable<DailyLoopFacts["decks"]> {
  const fact = (d: (typeof decks)[number]): DeckFact => ({ id: d.id, name: d.name, valid: d.valid, size: d.cards.length, sumOvr: d.sumOvr });
  const active = decks.find((x) => x.valid && x.id === activeId) ?? decks.find((x) => x.valid) ?? null;
  const invalid = decks.find((x) => !x.valid) ?? null;
  return { total: decks.length, valid: decks.filter((d) => d.valid).length, active: active ? fact(active) : null, firstInvalid: invalid ? fact(invalid) : null };
}

/**
 * Partidas abiertas del jugador. Columnas PÚBLICAS únicamente: nunca `state` ni `rng` (llevan las cartas
 * que el rival no ha jugado y el futuro del bot). Del rival humano solo sale su `username`.
 */
export async function readActiveMatches(sb: SupabaseClient, userId: string): Promise<{ matches: ActiveMatchFact[]; draftRun: { id: string; status: "DRAFTING" | "READY"; stage: number } | null }> {
  type PvpRow = { id: string; mode: string; user_id: string; player_b_id: string | null; closed_reason: string | null };
  const PVP_COLS = "id, mode, user_id, player_b_id, closed_reason";
  const [pve, asA, asB, attempt, draft] = await Promise.all([
    must<{ id: string; difficulty: string } | null>(sb.from("duel_matches").select("id, difficulty")
      .eq("user_id", userId).eq("mode", "PVE").eq("status", "IN_PROGRESS").order("updated_at", { ascending: false }).limit(1).maybeSingle()),
    must<PvpRow[] | null>(sb.from("duel_matches").select(PVP_COLS)
      .eq("user_id", userId).in("mode", ["PVP", "PVP_PRIVATE"]).eq("status", "IN_PROGRESS").order("updated_at", { ascending: false }).limit(3)),
    must<PvpRow[] | null>(sb.from("duel_matches").select(PVP_COLS)
      .eq("player_b_id", userId).in("mode", ["PVP", "PVP_PRIVATE"]).eq("status", "IN_PROGRESS").order("updated_at", { ascending: false }).limit(3)),
    // Sin 0051 (o con error), simplemente no hay contexto de campaña: la partida sigue siendo PvE.
    must<{ node_id: string; match_id: string | null } | null>(sb.from("campaign_attempts").select("node_id, match_id")
      .eq("user_id", userId).eq("status", "STARTED").limit(1).maybeSingle()).catch(() => null),
    // Fase 40 · combate de Draft Gauntlet en curso (0053); Fase 42 · la MISMA lectura trae la run fuera de combate
    // (DRAFTING / READY). Una sola consulta a `draft_runs`. Sin la tabla, simplemente no hay.
    must<{ id: string; status: string; stage: number } | null>(sb.from("draft_runs").select("id, status, stage")
      .eq("user_id", userId).in("status", ["IN_MATCH", "DRAFTING", "READY"]).order("created_at", { ascending: false }).limit(1).maybeSingle()).catch(() => null),
  ]);
  const out: ActiveMatchFact[] = [];
  const pvp = [...(asA ?? []), ...(asB ?? [])].find((m) => m.closed_reason === null) ?? null;
  if (pvp) {
    const rivalId = pvp.user_id === userId ? pvp.player_b_id : pvp.user_id;
    const rival = rivalId
      ? await must<{ username: string | null } | null>(sb.from("profiles").select("username").eq("id", rivalId).maybeSingle()).catch(() => null)
      : null;
    out.push({ id: pvp.id, mode: pvp.mode === "PVP_PRIVATE" ? "PRIVATE" : "RANKED", difficulty: null, opponent: rival?.username ?? null, node: null });
  }
  if (pve) {
    const campaignNode = attempt && attempt.match_id === pve.id ? findNode(ROAD_TO_CHAMPIONS, attempt.node_id) : null;
    out.push({
      id: pve.id,
      mode: campaignNode ? "CAMPAIGN" : "PVE",
      difficulty: DIFFICULTIES.has(pve.difficulty) ? (pve.difficulty as Difficulty) : null,
      opponent: null,
      node: campaignNode ? { id: campaignNode.node.id, name: campaignNode.node.name } : null,
    });
  }
  if (draft && draft.status === "IN_MATCH") out.push({ id: draft.id, mode: "DRAFT", difficulty: null, opponent: null, node: null });
  const draftRun = draft && (draft.status === "DRAFTING" || draft.status === "READY") ? { id: draft.id, status: draft.status as "DRAFTING" | "READY", stage: Number(draft.stage) || 1 } : null;
  return { matches: out, draftRun };
}

/** Retos privados recibidos y vivos (reloj del servidor). Del retador solo sale su `username` público. */
async function readIncomingChallenges(sb: SupabaseClient, userId: string, now: number): Promise<{ incoming: number; from: string | null }> {
  const rows = await must<{ challenger_id: string; expires_at: string }[] | null>(sb.from("duel_challenges").select("challenger_id, expires_at")
    .eq("challenged_id", userId).eq("status", "PENDING").gt("expires_at", new Date(now).toISOString())
    .order("created_at", { ascending: true }).limit(CHALLENGES_MAX));
  const live = (rows ?? []).filter((r) => Date.parse(r.expires_at) > now);
  if (live.length === 0) return { incoming: 0, from: null };
  const who = await must<{ username: string | null } | null>(sb.from("profiles").select("username").eq("id", live[0].challenger_id).maybeSingle()).catch(() => null);
  return { incoming: live.length, from: who?.username ?? null };
}
