/**
 * LIVE EVENTS 1.0 — MODELOS DE LECTURA (Fase 30, SOLO SERVIDOR).
 *
 * Tres fotos derivadas de las tablas REALES del pipeline de esports —`events`, `stages`,
 * `matches` (+ estructura 0045), `match_maps`, `maps`, `map_player_stats`, `teams`, `players`,
 * `standings`— y de los sistemas que ya existen alrededor: Pick'ems (`pickem_*`), desafíos de
 * evento (`services/events`), catálogo de cartas (`server/catalog`), sobres (`publicPacks`) y la
 * salud del worker (`sync_state['esports:autosync']`, solo legible desde el servidor).
 *
 *   getEventsOverview  → EN CURSO · PRÓXIMAMENTE · FINALIZADOS + evento principal
 *   getEventHub        → todo lo que el Event Hub pinta, ya derivado
 *   getEventMatch      → un partido: mapas, marcadores, estadísticas, predicción relacionada
 *
 * **No es autoridad de nada.** No escribe partidos, resultados, predicciones ni recompensas: el
 * esport real es la fuente de verdad y, si el backend no lo sabe, aquí tampoco. Un partido está
 * EN DIRECTO solo si `matches.status` lo dice; un ganador solo si `winner_team_id` existe; un mapa
 * sin nombre es «TBD». Los datos personales (predicciones, propiedad, objetivos) solo con sesión.
 * Consultas ACOTADAS y agrupadas: nada de N+1 por jugador, equipo, carta o partido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog, serverCatalogSync } from "@/server/catalog";
import { readHealth } from "@/lib/esports/autosync/health";
import { publicPacks } from "@/components/packs/packCatalog";
import { resolveTeamIdentity } from "@/data/teamIdentities";
import { challengesFor, totalReward, type EventChallengeDef } from "@/domain/events/challenges";
import type { Reward } from "@/domain/events/types";
import { REWARD_TIERS, tierForPoints } from "@/domain/pickems/rewards";
import {
  deriveEventState, rankEvents, groupEvents, syncFreshness, FRESHNESS_NOTICE, collectionProgress, eventActions, eventActivity,
  teamRecords, winnerSideOf, mapLabel, isPlaceholderTeam, LIFECYCLE_LABEL,
  type EventLike, type MatchLike, type StageLike, type EventState, type EventLifecycle, type SyncFreshness, type EventAction,
  type EventActivityItem, type CollectionProgress, type TeamRecord,
} from "@/domain/liveEvents/eventState";
import { catalogPlayerIdFor } from "@/domain/liveEvents/playerCards";
import { getEventViewFor, type EventView } from "./events";

export interface LiveResult<T> { ok: boolean; status: number; error?: string; code?: string; data?: T }
const fail = (status: number, error: string, code?: string): LiveResult<never> => ({ ok: false, status, error, code });
const done = <T>(data: T): LiveResult<T> => ({ ok: true, status: 200, data });

/* ───────────────────────────── filas ───────────────────────────── */

interface EventRow { id: string; name: string; type: string | null; region: string | null; status: string | null; start_date: string | null; end_date: string | null; source: string | null; location: string | null; prize_pool: number | null }
const EVENT_COLS = "id, name, type, region, status, start_date, end_date, source, location, prize_pool";

interface MatchRow {
  id: string; event_id: string; team_a: string | null; team_b: string | null; team_a_id: string | null; team_b_id: string | null;
  start_time: string | null; status: string; score_a: number | null; score_b: number | null; winner_team_id: string | null; winner_team: string | null;
  round: string | null; match_order: number | null; stage_id: string | null; format?: string | null; best_of?: number | null;
  winner_to_match_id?: string | null; winner_to_slot?: 1 | 2 | null; loser_to_match_id?: string | null; loser_to_slot?: 1 | 2 | null;
  winner_qualifies?: string | null; winner_qualifies_label?: string | null; progression_evidence?: string | null; progression_confidence?: string | null;
}
const MATCH_BASE = "id, event_id, team_a, team_b, team_a_id, team_b_id, start_time, status, score_a, score_b, winner_team_id, winner_team, round, match_order, stage_id, format, best_of";
const MATCH_PROGRESSION = "winner_to_match_id, winner_to_slot, loser_to_match_id, loser_to_slot, winner_qualifies, winner_qualifies_label, progression_evidence, progression_confidence";

interface StageRow { id: string; event_id: string; slug: string; name: string; kind: string | null; order_idx: number }
interface TeamRow { id: string; name: string; tag: string | null; region: string | null; slug: string | null; color: string | null }
interface PlayerRow { id: string; nick: string; team_id: string | null; role: string | null; country: string | null; is_substitute: boolean | null }
interface StandingRow { team_id: string; stage_id: string | null; position: number | null; wins: number; losses: number | null; ties: number | null; map_diff: number | null; round_diff: number | null; points: number; group_label: string | null; status: string }
interface PickemEventRow { id: string; event_id: string; status: string; title: string; locks_at: string }
interface QuestionRow { id: string; pickem_event_id: string; kind: string; match_id: string | null; prompt: string; options: { key: string; label: string }[]; points: number; locks_at: string; correct_option: string | null; order_idx: number }
interface AnswerRow { question_id: string; option_key: string; is_correct: boolean | null; points_award: number | null; updated_at: string | null }

const ms = (iso: string | null | undefined): number | null => { if (!iso) return null; const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };
const EVENT_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]|:){0,63}$/;
const MAX_EVENTS = 24;
const MAX_MATCHES = 400;

const toEvent = (r: EventRow): EventLike => ({ id: r.id, name: r.name, status: r.status, startDate: r.start_date, endDate: r.end_date, region: r.region, type: r.type, source: r.source });
const toMatch = (r: MatchRow): MatchLike => ({
  id: r.id, status: r.status, startTime: r.start_time, teamA: r.team_a, teamB: r.team_b, teamAId: r.team_a_id, teamBId: r.team_b_id,
  scoreA: r.score_a, scoreB: r.score_b, winnerTeamId: r.winner_team_id, round: r.round, matchOrder: r.match_order, stageId: r.stage_id, bestOf: r.best_of ?? null,
});
const toStage = (r: StageRow): StageLike => ({ id: r.id, name: r.name, kind: r.kind, orderIdx: r.order_idx });

/* ───────────────────────────── tipos públicos ───────────────────────────── */

export interface MatchSummary {
  id: string; status: string; label: "PROGRAMADO" | "EN CURSO" | "FINALIZADO";
  teamA: string | null; teamB: string | null; teamAId: string | null; teamBId: string | null;
  scoreA: number | null; scoreB: number | null; winner: "a" | "b" | null;
  startTime: string | null; round: string | null; stageName: string | null; bestOf: number | null;
}

export interface SyncView { freshness: SyncFreshness; notice: string | null; lastSuccessAt: string | null }

export interface EventCardView {
  id: string; name: string; region: string | null; type: string | null; isDemo: boolean;
  lifecycle: EventLifecycle; label: string; startDate: string | null; endDate: string | null;
  progress: { completed: number; total: number; pct: number };
  liveCount: number; nextMatch: MatchSummary | null; liveMatch: MatchSummary | null;
  participants: number; currentStage: string | null;
  /** Solo con sesión; `null` sin Pick'em. */
  /** `nextLockAt` (Fase 42): cierre más próximo de una pregunta abierta SIN responder por el usuario (solo la hora). */
  pickem: { open: number; pending: number; nextLockAt: number | null } | null;
}

export interface EventsOverviewSnapshot {
  active: EventCardView[]; upcoming: EventCardView[]; completed: EventCardView[];
  mainEventId: string | null;
  sync: SyncView;
  serverNow: number;
}

export interface TeamView {
  id: string; name: string; tag: string | null; region: string | null;
  /** Identidad VERIFICADA del catálogo, si existe y no es ambigua. */
  identity: { canonicalId: string; displayName: string; tag: string; verified: boolean } | null;
  record: TeamRecord | null;
  /** Solo si `standings.status` dice algo distinto de `active` (deuda conocida: casi nunca). */
  eventStatus: "qualified" | "eliminated" | null;
  players: number;
  pack: { id: string; name: string } | null;
}

export interface PlayerView {
  id: string; nick: string; teamId: string | null; teamName: string | null;
  /** Rol REAL de la fuente (`players.role`), o `null`. Nunca inferido. */
  role: string | null; country: string | null; substitute: boolean;
  /** Ids de cartas del catálogo de ESTE jugador; vacío si no hay costura. */
  cardIds: string[];
}

export interface EventCardItem { cardId: string; playerId: string; nick: string; variantId: string; ovr: number; owned: boolean; teamName: string | null }

export interface PickemView {
  id: string; status: string; title: string; locksAt: string;
  open: number; answered: number; pending: number; total: number; resolved: number; correct: number;
  nextLockAt: string | null;
  score: { points: number; correct: number; total: number } | null;
  tier: { id: string; label: string } | null;
  /** Por partido: qué tengo en juego (solo presentación; el servidor ya corrigió). */
  byMatch: Record<string, { questionId: string; state: "open" | "picked" | "locked" | "correct" | "wrong" | "missed"; locked: boolean }>;
}

export interface ObjectiveView {
  id: string; label: string; description: string; goal: number; progress: number; complete: boolean; claimed: boolean; claimable: boolean; reward: Reward;
}

export interface StandingView { teamId: string; teamName: string; position: number | null; wins: number; losses: number; ties: number; mapDiff: number | null; roundDiff: number | null; points: number; group: string | null; stageId: string | null; status: "qualified" | "eliminated" | null }

export interface EventHubSnapshot {
  event: { id: string; name: string; region: string | null; type: string | null; isDemo: boolean; startDate: string | null; endDate: string | null; location: string | null; prizePool: number | null };
  state: { lifecycle: EventLifecycle; label: string; progress: { completed: number; total: number; pct: number }; currentStage: string | null; liveCount: number; firstMatchAt: string | null; lastMatchAt: string | null };
  format: string | null;
  stages: { id: string; name: string; kind: string | null; orderIdx: number; total: number; completed: number }[];
  liveMatches: MatchSummary[];
  nextMatches: MatchSummary[];
  recentResults: MatchSummary[];
  /** Todos los partidos del evento (acotado a 400), para calendario y cuadro. */
  matches: (MatchRow & { label: MatchSummary["label"]; winner: "a" | "b" | null; stageName: string | null })[];
  standings: StandingView[];
  participants: TeamView[];
  players: PlayerView[];
  cards: EventCardItem[];
  collection: CollectionProgress | null;
  packs: { id: string; name: string; teamName: string }[];
  pickem: PickemView | null;
  objectives: { set: string; items: ObjectiveView[]; claimable: number; pending: number; totalReward: Reward; signedIn: boolean };
  rewards: { pickemTiers: { id: string; label: string; minPoints: number; reward: Reward; reached: boolean }[]; challengesTotal: Reward; claimed: number; earnedTier: string | null };
  actions: EventAction[];
  activity: EventActivityItem[];
  sync: SyncView;
  signedIn: boolean;
  serverNow: number;
}

export interface EventMatchSnapshot {
  event: { id: string; name: string; isDemo: boolean };
  match: MatchSummary & { format: string | null; stageId: string | null };
  teams: { a: TeamView | null; b: TeamView | null };
  maps: { order: number; name: string; tbd: boolean; scoreA: number | null; scoreB: number | null; winner: "a" | "b" | null; duration: number | null }[];
  stats: { mapOrder: number; playerId: string; nick: string; teamId: string | null; agent: string | null; acs: number | null; kills: number | null; deaths: number | null; assists: number | null; adr: number | null; rating: number | null }[];
  question: { id: string; kind: string; prompt: string; options: { key: string; label: string }[]; points: number; locksAt: string; locked: boolean; correctOption: string | null; myOption: string | null; myCorrect: boolean | null } | null;
  sync: SyncView;
  signedIn: boolean;
  serverNow: number;
}

/* ───────────────────────────── lecturas agrupadas ───────────────────────────── */

async function matchesFor(sb: SupabaseClient, eventIds: string[], limit: number): Promise<MatchRow[]> {
  if (eventIds.length === 0) return [];
  const q = (cols: string) => sb.from("matches").select(cols).in("event_id", eventIds).order("start_time", { ascending: true, nullsFirst: false }).order("match_order", { ascending: true }).limit(limit);
  const full = await q(`${MATCH_BASE}, ${MATCH_PROGRESSION}`);
  if (!full.error) return (full.data ?? []) as unknown as MatchRow[];
  // Pre-0045: sin columnas de estructura PostgREST responde 42703; el cuadro se dibuja por resultados.
  const msg = (full.error.message ?? "").toLowerCase();
  if (full.error.code !== "42703" && !(msg.includes("column") && msg.includes("does not exist"))) throw new Error(full.error.message);
  const base = await q(MATCH_BASE);
  if (base.error) throw new Error(base.error.message);
  return (base.data ?? []) as unknown as MatchRow[];
}

async function stagesFor(sb: SupabaseClient, eventIds: string[]): Promise<StageRow[]> {
  if (eventIds.length === 0) return [];
  const { data, error } = await sb.from("stages").select("id, event_id, slug, name, kind, order_idx").in("event_id", eventIds).order("order_idx", { ascending: true }).limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as StageRow[];
}

async function syncView(sb: SupabaseClient, lifecycle: EventLifecycle, hasLive: boolean, now: number): Promise<SyncView> {
  const h = await readHealth(sb);
  const freshness = syncFreshness({ lastSuccessAt: h.lastSuccessAt, lastAttemptAt: h.lastAttemptAt, consecutiveFailures: h.consecutiveFailures, lifecycle, hasLive, now });
  return { freshness, notice: FRESHNESS_NOTICE[freshness], lastSuccessAt: h.lastSuccessAt };
}

interface PickemFacts { row: PickemEventRow; questions: QuestionRow[]; answers: Map<string, AnswerRow>; score: { points: number; correct: number; total: number } | null }

/** Pick'em de un evento (el más antiguo, como el resto del producto) + mis respuestas si hay sesión. */
async function pickemFor(sb: SupabaseClient, userId: string | null, eventId: string): Promise<PickemFacts | null> {
  const { data: pe } = await sb.from("pickem_events").select("id, event_id, status, title, locks_at").eq("event_id", eventId).order("created_at", { ascending: true }).limit(1).maybeSingle();
  const row = pe as PickemEventRow | null;
  if (!row) return null;
  const { data: qs, error } = await sb.from("pickem_questions").select("id, pickem_event_id, kind, match_id, prompt, options, points, locks_at, correct_option, order_idx").eq("pickem_event_id", row.id).order("order_idx", { ascending: true }).limit(200);
  if (error) throw new Error(error.message);
  const answers = new Map<string, AnswerRow>();
  let score: PickemFacts["score"] = null;
  if (userId) {
    const [{ data: sub }, { data: sc }] = await Promise.all([
      sb.from("pickem_submissions").select("id").eq("user_id", userId).eq("pickem_event_id", row.id).maybeSingle(),
      sb.from("pickem_scores").select("points, correct, total").eq("user_id", userId).eq("pickem_event_id", row.id).maybeSingle(),
    ]);
    const submissionId = (sub as { id: string } | null)?.id ?? null;
    if (submissionId) {
      const { data: ans } = await sb.from("pickem_answers").select("question_id, option_key, is_correct, points_award, updated_at").eq("submission_id", submissionId).limit(200);
      for (const a of (ans ?? []) as AnswerRow[]) answers.set(a.question_id, a);
    }
    score = (sc as PickemFacts["score"]) ?? null;
  }
  return { row, questions: (qs ?? []) as QuestionRow[], answers, score };
}

function pickemView(f: PickemFacts, now: number, signedIn: boolean): PickemView {
  const open = f.questions.filter((q) => (ms(q.locks_at) ?? 0) > now);
  const answered = f.questions.filter((q) => f.answers.has(q.id));
  const pending = signedIn ? open.filter((q) => !f.answers.has(q.id)) : [];
  const resolved = f.questions.filter((q) => (ms(q.locks_at) ?? 0) <= now && q.correct_option !== null);
  const correct = resolved.filter((q) => f.answers.get(q.id)?.is_correct === true);
  const nextLock = open.map((q) => ms(q.locks_at)!).sort((a, b) => a - b)[0];
  const byMatch: PickemView["byMatch"] = {};
  for (const q of f.questions) {
    if (!q.match_id || q.kind !== "match_winner") continue;
    const locked = (ms(q.locks_at) ?? 0) <= now;
    const mine = f.answers.get(q.id);
    const state: PickemView["byMatch"][string]["state"] = locked && q.correct_option
      ? mine ? (mine.option_key === q.correct_option ? "correct" : "wrong") : "missed"
      : locked ? (mine ? "locked" : "missed") : mine ? "picked" : "open";
    byMatch[q.match_id] = { questionId: q.id, state, locked };
  }
  const tier = f.score ? tierForPoints(f.score.points) : null;
  return {
    id: f.row.id, status: f.row.status, title: f.row.title, locksAt: f.row.locks_at,
    open: open.length, answered: answered.length, pending: pending.length, total: f.questions.length, resolved: resolved.length, correct: correct.length,
    nextLockAt: nextLock !== undefined ? new Date(nextLock).toISOString() : null,
    score: f.score, tier: tier ? { id: tier.id, label: tier.label } : null, byMatch,
  };
}

const summary = (m: MatchLike, stageName: string | null, legacyWinner?: string | null): MatchSummary => ({
  id: m.id, status: m.status, label: isLive(m) ? "EN CURSO" : isFin(m) ? "FINALIZADO" : "PROGRAMADO",
  teamA: m.teamA, teamB: m.teamB, teamAId: m.teamAId, teamBId: m.teamBId, scoreA: m.scoreA, scoreB: m.scoreB,
  winner: winnerSideOf(m, legacyWinner, { a: m.teamA, b: m.teamB }), startTime: m.startTime, round: m.round, stageName, bestOf: m.bestOf ?? null,
});
const isLive = (m: Pick<MatchLike, "status">) => ["live", "ongoing"].includes((m.status ?? "").toLowerCase());
const isFin = (m: Pick<MatchLike, "status">) => ["finished", "completed", "final"].includes((m.status ?? "").toLowerCase());

/* ───────────────────────────── overview ───────────────────────────── */

export async function getEventsOverview(sb: SupabaseClient, userId: string | null, opts: { now?: number } = {}): Promise<LiveResult<EventsOverviewSnapshot>> {
  const now = opts.now ?? Date.now();
  try {
    const { data, error } = await sb.from("events").select(EVENT_COLS).order("start_date", { ascending: false, nullsFirst: false }).limit(MAX_EVENTS);
    if (error) throw new Error(error.message);
    const events = (data ?? []) as EventRow[];
    const ids = events.map((e) => e.id);
    const [matches, stages] = await Promise.all([matchesFor(sb, ids, MAX_EVENTS * 120), stagesFor(sb, ids)]);
    const byEvent = new Map<string, MatchLike[]>();
    for (const m of matches) { const l = byEvent.get(m.event_id) ?? []; l.push(toMatch(m)); byEvent.set(m.event_id, l); }
    const stagesByEvent = new Map<string, StageLike[]>();
    for (const s of stages) { const l = stagesByEvent.get(s.event_id) ?? []; l.push(toStage(s)); stagesByEvent.set(s.event_id, l); }
    const stageName = new Map(stages.map((s) => [s.id, s.name]));

    const ranked = rankEvents(events.map((r) => {
      const event = toEvent(r);
      return { event, row: r, state: deriveEventState({ event, matches: byEvent.get(r.id) ?? [], stages: stagesByEvent.get(r.id), now }) };
    }), now);

    // Pick'ems pendientes por evento, en dos consultas agrupadas (solo con sesión y solo eventos no terminados).
    const pending = new Map<string, { open: number; pending: number; nextLockAt: number | null }>();
    const openEvents = ranked.filter((x) => x.state.lifecycle !== "COMPLETED").map((x) => x.event.id);
    if (openEvents.length > 0) {
      const { data: pes } = await sb.from("pickem_events").select("id, event_id, status, title, locks_at").in("event_id", openEvents).order("created_at", { ascending: true }).limit(60);
      const firstByEvent = new Map<string, PickemEventRow>();
      for (const p of (pes ?? []) as PickemEventRow[]) if (!firstByEvent.has(p.event_id)) firstByEvent.set(p.event_id, p);
      const pickemIds = [...firstByEvent.values()].map((p) => p.id);
      if (pickemIds.length > 0) {
        const { data: qs } = await sb.from("pickem_questions").select("id, pickem_event_id, locks_at").in("pickem_event_id", pickemIds).limit(1000);
        const questions = (qs ?? []) as { id: string; pickem_event_id: string; locks_at: string }[];
        const answered = new Set<string>();
        if (userId) {
          const { data: subs } = await sb.from("pickem_submissions").select("id, pickem_event_id").eq("user_id", userId).in("pickem_event_id", pickemIds);
          const subIds = ((subs ?? []) as { id: string }[]).map((s) => s.id);
          if (subIds.length > 0) {
            const { data: ans } = await sb.from("pickem_answers").select("question_id").in("submission_id", subIds).limit(2000);
            for (const a of (ans ?? []) as { question_id: string }[]) answered.add(a.question_id);
          }
        }
        for (const [eventId, pe] of firstByEvent) {
          const open = questions.filter((q) => q.pickem_event_id === pe.id && (ms(q.locks_at) ?? 0) > now);
          const mine = userId ? open.filter((q) => !answered.has(q.id)) : [];
          const locks = mine.map((q) => ms(q.locks_at)).filter((x): x is number => x !== null);
          pending.set(eventId, { open: open.length, pending: mine.length, nextLockAt: locks.length ? Math.min(...locks) : null });
        }
      }
    }

    const card = (x: (typeof ranked)[number]): EventCardView => {
      const s = x.state;
      const live = s.liveMatches[0] ?? null;
      return {
        id: x.event.id, name: x.event.name, region: x.event.region, type: x.event.type, isDemo: x.event.source === "demo",
        lifecycle: s.lifecycle, label: LIFECYCLE_LABEL[s.lifecycle], startDate: x.event.startDate, endDate: x.event.endDate,
        progress: { completed: s.completedMatches, total: s.totalMatches, pct: s.progressPct },
        liveCount: s.liveMatches.length,
        liveMatch: live ? summary(live, live.stageId ? stageName.get(live.stageId) ?? null : null) : null,
        nextMatch: s.nextMatch ? summary(s.nextMatch, s.nextMatch.stageId ? stageName.get(s.nextMatch.stageId) ?? null : null) : null,
        participants: s.participantIds.length, currentStage: s.currentStage?.name ?? null,
        pickem: pending.get(x.event.id) ?? null,
      };
    };
    const groups = groupEvents(ranked, now);
    const main = ranked[0] ?? null;
    const sync = await syncView(sb, main?.state.lifecycle ?? "COMPLETED", !!main && main.state.liveMatches.length > 0, now);
    return done({ active: groups.active.map(card), upcoming: groups.upcoming.map(card), completed: groups.completed.map(card), mainEventId: main?.event.id ?? null, sync, serverNow: now });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudieron leer los eventos");
  }
}

/* ───────────────────────────── hub ───────────────────────────── */

function identityOf(t: TeamRow): TeamView["identity"] {
  const id = resolveTeamIdentity(t.name) ?? resolveTeamIdentity(t.tag);
  return id ? { canonicalId: id.canonicalId, displayName: id.displayName, tag: id.tag, verified: id.status === "verified" } : null;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Sobres ACTIVE de equipos participantes: por identidad canónica y, sin identidad, por nombre/etiqueta exactos. */
function packsForTeams(teams: TeamRow[]): Map<string, { id: string; name: string }> {
  const out = new Map<string, { id: string; name: string }>();
  const packs = publicPacks().filter((p) => !!p.team);
  for (const t of teams) {
    const tid = resolveTeamIdentity(t.name) ?? resolveTeamIdentity(t.tag);
    const hit = packs.find((p) => {
      const pid = resolveTeamIdentity(p.team);
      if (tid && pid) return tid.canonicalId === pid.canonicalId;
      if (tid || pid) return false; // una identidad conocida frente a un alias desconocido: no se adivina
      return norm(p.team) === norm(t.name) || (!!t.tag && norm(p.team) === norm(t.tag));
    });
    if (hit) out.set(t.id, { id: hit.id, name: hit.name });
  }
  return out;
}

export async function getEventHub(sb: SupabaseClient, userId: string | null, eventId: string, opts: { now?: number } = {}): Promise<LiveResult<EventHubSnapshot>> {
  if (!EVENT_ID.test(eventId)) return fail(400, "Evento no válido");
  const now = opts.now ?? Date.now();
  try {
    const { data: erow, error } = await sb.from("events").select(EVENT_COLS).eq("id", eventId).maybeSingle();
    if (error) throw new Error(error.message);
    const r = erow as EventRow | null;
    if (!r) return fail(404, "Evento no encontrado");
    const event = toEvent(r);

    const [matchRows, stageRows, pickemFacts, standingsRes] = await Promise.all([
      matchesFor(sb, [eventId], MAX_MATCHES), stagesFor(sb, [eventId]), pickemFor(sb, userId, eventId),
      sb.from("standings").select("team_id, stage_id, position, wins, losses, ties, map_diff, round_diff, points, group_label, status").eq("event_id", eventId).order("position", { ascending: true, nullsFirst: false }).limit(200),
    ]);
    const matches = matchRows.map(toMatch);
    const stages = stageRows.map(toStage);
    const stageName = new Map(stageRows.map((s) => [s.id, s.name]));
    const state = deriveEventState({ event, matches, stages, now });
    const records = teamRecords(matches);

    // Equipos y jugadores participantes: dos consultas agrupadas.
    const teamIds = state.participantIds;
    const [{ data: trows }, { data: prows }] = await Promise.all([
      teamIds.length ? sb.from("teams").select("id, name, tag, region, slug, color").in("id", teamIds).limit(64) : Promise.resolve({ data: [] as TeamRow[] }),
      teamIds.length ? sb.from("players").select("id, nick, team_id, role, country, is_substitute").in("team_id", teamIds).order("nick", { ascending: true }).limit(400) : Promise.resolve({ data: [] as PlayerRow[] }),
    ]);
    const teams = ((trows ?? []) as TeamRow[]).filter((t) => !isPlaceholderTeam(t.name));
    const teamName = new Map(teams.map((t) => [t.id, t.name]));
    const players = (prows ?? []) as PlayerRow[];
    const packs = packsForTeams(teams);

    // Cartas del evento: jugador real → slug del catálogo → cartas EXISTENTES. Sin costura, sin carta.
    await serverCatalog(sb);
    const registry = serverCatalogSync().registry;
    const playerViews: PlayerView[] = players.map((p) => {
      const slug = catalogPlayerIdFor({ id: p.id, nick: p.nick });
      const cards = slug ? registry.forPlayer(slug) : [];
      return { id: p.id, nick: p.nick, teamId: p.team_id, teamName: p.team_id ? teamName.get(p.team_id) ?? null : null, role: p.role || null, country: p.country, substitute: !!p.is_substitute, cardIds: cards.map((c) => c.id) };
    });
    const cardIds = [...new Set(playerViews.flatMap((p) => p.cardIds))];
    const owned = new Set<string>();
    if (userId && cardIds.length > 0) {
      for (let i = 0; i < cardIds.length; i += 300) {
        const { data: oc } = await sb.from("user_cards").select("card_id").eq("user_id", userId).in("card_id", cardIds.slice(i, i + 300));
        for (const c of (oc ?? []) as { card_id: string }[]) owned.add(c.card_id);
      }
    }
    const cards: EventCardItem[] = [];
    for (const p of playerViews) for (const id of p.cardIds) {
      const c = registry.card(id); if (!c) continue;
      cards.push({ cardId: id, playerId: p.id, nick: p.nick, variantId: c.variantId, ovr: c.ovr, owned: owned.has(id), teamName: p.teamName });
    }
    cards.sort((a, b) => b.ovr - a.ovr || a.nick.localeCompare(b.nick));
    const collection = cardIds.length > 0 ? collectionProgress(cardIds, userId ? owned : []) : null;

    // Clasificación real (si hay filas). `status` solo si dice algo distinto de `active`.
    const standings: StandingView[] = ((standingsRes.data ?? []) as StandingRow[]).map((s) => ({
      teamId: s.team_id, teamName: teamName.get(s.team_id) ?? s.team_id, position: s.position, wins: s.wins, losses: s.losses ?? 0, ties: s.ties ?? 0,
      mapDiff: s.map_diff, roundDiff: s.round_diff, points: s.points, group: s.group_label, stageId: s.stage_id,
      status: s.status === "qualified" || s.status === "eliminated" ? s.status : null,
    }));
    const statusByTeam = new Map(standings.filter((s) => s.status).map((s) => [s.teamId, s.status!]));
    const playersByTeam = new Map<string, number>();
    for (const p of players) if (p.team_id) playersByTeam.set(p.team_id, (playersByTeam.get(p.team_id) ?? 0) + 1);

    const participants: TeamView[] = teams.map((t) => ({
      id: t.id, name: t.name, tag: t.tag, region: t.region, identity: identityOf(t), record: records.get(t.id) ?? null,
      eventStatus: statusByTeam.get(t.id) ?? null, players: playersByTeam.get(t.id) ?? 0, pack: packs.get(t.id) ?? null,
    })).sort((a, b) => (b.record?.wins ?? 0) - (a.record?.wins ?? 0) || a.name.localeCompare(b.name));

    // Objetivos del evento: los desafíos existentes (definiciones reales + hechos reales), sin segundo motor.
    const defs: EventChallengeDef[] = challengesFor({ id: event.id, type: event.type, region: event.region });
    let view: EventView | null = null;
    if (userId) { const v = await getEventViewFor(sb, userId, eventId, now); view = v.ok ? v.data ?? null : null; }
    const items: ObjectiveView[] = view
      ? view.challenges.map((c) => ({ id: c.id, label: c.label, description: c.description, goal: c.goal, progress: c.progress, complete: c.complete, claimed: c.claimed, claimable: c.claimable, reward: c.reward }))
      : defs.map((d) => ({ id: d.id, label: d.label, description: d.description, goal: d.goal, progress: 0, complete: false, claimed: false, claimable: false, reward: d.reward }));
    const claimable = items.filter((i) => i.claimable).length;
    const pendingObjectives = items.filter((i) => !i.complete).length;

    const pickem = pickemFacts ? pickemView(pickemFacts, now, !!userId) : null;
    const resolvedPicks = pickemFacts ? [...pickemFacts.answers.values()].map((a) => {
      const q = pickemFacts.questions.find((x) => x.id === a.question_id);
      return q?.match_id ? { matchId: q.match_id, correct: a.is_correct, at: a.updated_at } : null;
    }).filter((x): x is { matchId: string; correct: boolean | null; at: string | null } => x !== null) : [];

    const sn = (m: MatchLike) => summary(m, m.stageId ? stageName.get(m.stageId) ?? null : null, matchRows.find((x) => x.id === m.id)?.winner_team);
    const sync = await syncView(sb, state.lifecycle, state.liveMatches.length > 0, now);
    const earnedTier = pickem?.tier?.id ?? null;
    const points = pickem?.score?.points ?? 0;

    return done({
      event: { id: event.id, name: event.name, region: event.region, type: event.type, isDemo: event.source === "demo", startDate: event.startDate, endDate: event.endDate, location: r.location, prizePool: r.prize_pool },
      state: { lifecycle: state.lifecycle, label: LIFECYCLE_LABEL[state.lifecycle], progress: { completed: state.completedMatches, total: state.totalMatches, pct: state.progressPct }, currentStage: state.currentStage?.name ?? null, liveCount: state.liveMatches.length, firstMatchAt: state.firstMatchAt, lastMatchAt: state.lastMatchAt },
      format: null,
      stages: stageRows.map((s) => ({ id: s.id, name: s.name, kind: s.kind, orderIdx: s.order_idx, total: matches.filter((m) => m.stageId === s.id).length, completed: matches.filter((m) => m.stageId === s.id && isFin(m)).length })),
      liveMatches: state.liveMatches.map(sn), nextMatches: state.nextMatches.map(sn), recentResults: state.recentResults.map(sn),
      matches: matchRows.map((m) => ({ ...m, label: isLive(m) ? "EN CURSO" : isFin(m) ? "FINALIZADO" : "PROGRAMADO", winner: winnerSideOf({ winnerTeamId: m.winner_team_id, teamAId: m.team_a_id, teamBId: m.team_b_id }, m.winner_team, { a: m.team_a, b: m.team_b }), stageName: m.stage_id ? stageName.get(m.stage_id) ?? null : null })),
      standings, participants, players: playerViews, cards, collection,
      packs: participants.filter((t) => t.pack).map((t) => ({ id: t.pack!.id, name: t.pack!.name, teamName: t.name })),
      pickem,
      objectives: { set: view?.setLabel ?? "Desafíos del evento", items, claimable, pending: pendingObjectives, totalReward: totalReward(defs), signedIn: !!userId },
      rewards: { pickemTiers: REWARD_TIERS.map((t) => ({ id: t.id, label: t.label, minPoints: t.minPoints, reward: t.reward, reached: !!userId && points >= t.minPoints })), challengesTotal: totalReward(defs), claimed: view?.claimedCount ?? 0, earnedTier },
      actions: eventActions({ eventId, pickem: pickem ? { pending: pickem.pending, nextLockAt: pickem.nextLockAt } : null, objectives: { claimable, pending: userId ? pendingObjectives : 0 }, liveMatches: state.liveMatches, nextMatch: state.nextMatch, collection, packs: participants.filter((t) => t.pack).map((t) => t.pack!), now }),
      activity: eventActivity({ matches, resolvedPicks, max: 8 }),
      sync, signedIn: !!userId, serverNow: now,
    });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer el evento");
  }
}

/* ───────────────────────────── partido ───────────────────────────── */

const MATCH_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]|:){0,63}$/;

export async function getEventMatch(sb: SupabaseClient, userId: string | null, matchId: string, opts: { now?: number } = {}): Promise<LiveResult<EventMatchSnapshot>> {
  if (!MATCH_ID.test(matchId)) return fail(400, "Partido no válido");
  const now = opts.now ?? Date.now();
  try {
    const one = await sb.from("matches").select(`${MATCH_BASE}, ${MATCH_PROGRESSION}`).eq("id", matchId).maybeSingle();
    let row = one.data as MatchRow | null;
    if (one.error) {
      const base = await sb.from("matches").select(MATCH_BASE).eq("id", matchId).maybeSingle();
      if (base.error) throw new Error(base.error.message);
      row = base.data as MatchRow | null;
    }
    if (!row) return fail(404, "Partido no encontrado");
    const m = toMatch(row);

    const teamIds = [row.team_a_id, row.team_b_id].filter((x): x is string => !!x);
    const [{ data: ev }, { data: trows }, { data: stage }, { data: mmaps }, { data: mstats }] = await Promise.all([
      sb.from("events").select("id, name, source").eq("id", row.event_id).maybeSingle(),
      teamIds.length ? sb.from("teams").select("id, name, tag, region, slug, color").in("id", teamIds) : Promise.resolve({ data: [] as TeamRow[] }),
      row.stage_id ? sb.from("stages").select("id, name").eq("id", row.stage_id).maybeSingle() : Promise.resolve({ data: null as { id: string; name: string } | null }),
      sb.from("match_maps").select("id, map_id, map_order, score_a, score_b, winner_team_id, duration").eq("match_id", matchId).order("map_order", { ascending: true }).limit(9),
      sb.from("map_player_stats").select("match_map_id, player_id, team_id, agent_id, acs, kills, deaths, assists, adr, rating").eq("match_id", matchId).limit(200),
    ]);
    const e = ev as { id: string; name: string; source: string | null } | null;
    if (!e) return fail(404, "Partido no encontrado");
    const teams = (trows ?? []) as TeamRow[];
    const records = teamRecords([m]);
    const teamView = (id: string | null): TeamView | null => {
      const t = teams.find((x) => x.id === id);
      return t ? { id: t.id, name: t.name, tag: t.tag, region: t.region, identity: identityOf(t), record: records.get(t.id) ?? null, eventStatus: null, players: 0, pack: null } : null;
    };

    type MapRow = { id: string; map_id: string | null; map_order: number; score_a: number | null; score_b: number | null; winner_team_id: string | null; duration: number | null };
    const mapRows = (mmaps ?? []) as MapRow[];
    const mapIds = [...new Set(mapRows.map((x) => x.map_id).filter((x): x is string => !!x))];
    const mapNames = new Map<string, string>();
    if (mapIds.length) {
      const { data: names } = await sb.from("maps").select("id, name").in("id", mapIds);
      for (const n of (names ?? []) as { id: string; name: string }[]) mapNames.set(n.id, n.name);
    }
    const maps = mapRows.map((x) => ({
      order: x.map_order, name: mapLabel(x.map_id ? mapNames.get(x.map_id) ?? null : null), tbd: !x.map_id || !mapNames.has(x.map_id),
      scoreA: x.score_a, scoreB: x.score_b, duration: x.duration,
      winner: winnerSideOf({ winnerTeamId: x.winner_team_id, teamAId: row!.team_a_id, teamBId: row!.team_b_id }),
    }));

    type StatRow = { match_map_id: string; player_id: string | null; team_id: string | null; agent_id: string | null; acs: number | null; kills: number | null; deaths: number | null; assists: number | null; adr: number | null; rating: number | null };
    const statRows = ((mstats ?? []) as StatRow[]).filter((s) => !!s.player_id);
    const pids = [...new Set(statRows.map((s) => s.player_id!))];
    const nick = new Map<string, string>();
    if (pids.length) {
      const { data: prows } = await sb.from("players").select("id, nick").in("id", pids).limit(64);
      for (const p of (prows ?? []) as { id: string; nick: string }[]) nick.set(p.id, p.nick);
    }
    const orderOfMap = new Map(mapRows.map((x) => [x.id, x.map_order]));
    const stats = statRows.map((s) => ({ mapOrder: orderOfMap.get(s.match_map_id) ?? 0, playerId: s.player_id!, nick: nick.get(s.player_id!) ?? s.player_id!, teamId: s.team_id, agent: s.agent_id, acs: s.acs, kills: s.kills, deaths: s.deaths, assists: s.assists, adr: s.adr, rating: s.rating }))
      .sort((a, b) => a.mapOrder - b.mapOrder || (b.acs ?? 0) - (a.acs ?? 0));

    // Predicción relacionada: la pregunta de ganador de ESTE partido (cualquier Pick'em del evento).
    let question: EventMatchSnapshot["question"] = null;
    const { data: qrow } = await sb.from("pickem_questions").select("id, pickem_event_id, kind, match_id, prompt, options, points, locks_at, correct_option, order_idx").eq("match_id", matchId).eq("kind", "match_winner").order("created_at", { ascending: true }).limit(1).maybeSingle();
    const q = qrow as QuestionRow | null;
    if (q) {
      const locked = (ms(q.locks_at) ?? 0) <= now;
      let mine: AnswerRow | null = null;
      if (userId) {
        const { data: sub } = await sb.from("pickem_submissions").select("id").eq("user_id", userId).eq("pickem_event_id", q.pickem_event_id).maybeSingle();
        const sid = (sub as { id: string } | null)?.id;
        if (sid) {
          const { data: a } = await sb.from("pickem_answers").select("question_id, option_key, is_correct, points_award, updated_at").eq("submission_id", sid).eq("question_id", q.id).maybeSingle();
          mine = (a as AnswerRow | null) ?? null;
        }
      }
      // `correct_option` solo tras el cierre: el mismo contrato que la vista pública de Pick'ems.
      question = { id: q.id, kind: q.kind, prompt: q.prompt, options: q.options, points: q.points, locksAt: q.locks_at, locked, correctOption: locked ? q.correct_option : null, myOption: mine?.option_key ?? null, myCorrect: locked ? mine?.is_correct ?? null : null };
    }

    const lifecycle: EventLifecycle = isLive(m) ? "ACTIVE" : isFin(m) ? "COMPLETED" : "UPCOMING";
    const sync = await syncView(sb, lifecycle === "COMPLETED" ? "COMPLETED" : "ACTIVE", isLive(m), now);
    return done({
      event: { id: e.id, name: e.name, isDemo: e.source === "demo" },
      match: { ...summary(m, (stage as { name: string } | null)?.name ?? null, row.winner_team), format: row.format ?? null, stageId: row.stage_id },
      teams: { a: teamView(row.team_a_id), b: teamView(row.team_b_id) },
      maps, stats, question, sync, signedIn: !!userId, serverNow: now,
    });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer el partido");
  }
}

/** El número de la navegación: partidos EN DIRECTO reales ahora mismo (una consulta `head`). */
export async function getLiveCount(sb: SupabaseClient): Promise<LiveResult<{ live: number }>> {
  const { count, error } = await sb.from("matches").select("id", { count: "exact", head: true }).eq("status", "live");
  if (error) return fail(500, error.message);
  return done({ live: count ?? 0 });
}
