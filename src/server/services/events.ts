/**
 * EVENTOS EN VIVO — AUTORIDAD DE SERVIDOR (Fase 12, SOLO SERVIDOR).
 *
 * ────────────────────────── EL HUECO QUE CIERRA ──────────────────────────
 *
 * La Fase 10 lo dejó por escrito en su lista de pendientes: «Eventos server-side». Hasta
 * hoy, la capa de evento vivía entera en el navegador (`useEventsStore`), con su propia
 * economía en `localStorage`, y la pantalla de `/eventos` tuvo que quedarse en solo lectura
 * con sesión iniciada porque lo que repartía se borraba en la siguiente sincronización.
 *
 * Este módulo es la respuesta, y la respuesta cabe en una frase: **el servidor decide.**
 *
 *   · Si el evento existe        → `public.events`
 *   · Si está activo, y en qué fase → `domain/events/lifecycle` con la hora del SERVIDOR
 *   · Qué desafíos hay           → `domain/events/challenges`, por datos del evento
 *   · Cuánto llevas              → contado sobre las tablas donde ya está el hecho
 *   · Si puedes cobrar           → fase + progreso + no reclamado antes
 *   · Y el pago                  → `services/rewards.award()`, la ruta única
 *
 * El cliente no envía cantidades, ni fechas, ni progreso. Envía el id de un desafío. Todo
 * lo demás lo calcula este fichero.
 *
 * ────────────────────────── LO QUE NO SE HA CREADO ──────────────────────────
 *
 * Ninguna tabla. Ninguna migración. Ninguna entidad «evento» paralela a `public.events`.
 * Ninguna segunda ruta de recompensa. La Fase 12 prohíbe los sistemas paralelos y aquí el
 * trabajo ha sido justamente el contrario: encontrar dónde encajaba cada pieza en lo que ya
 * existía.
 *
 * La única decisión de almacenamiento es reutilizar `user_achievements` para lo reclamado,
 * con el id `event:<evento>:<desafío>`. Esa tabla ya guarda «qué reclamó quién y cuándo»,
 * ya está cerrada al cliente y ya tiene su RLS — y de paso deja el historial de eventos
 * pasados que el encargo pide, sin escribir una línea de esquema.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  eventPhase, canClaimInPhase, isRunning, claimClosesAt, msUntilNextPhase,
  PHASE_LABEL, type EventPhase, type EventTiming,
} from "@/domain/events/lifecycle";
import {
  challengesFor, challengeById, challengeRef, challengeSetFor, totalReward,
  type EventChallengeDef, type EventMetric, type EventShape,
} from "@/domain/events/challenges";
import type { Reward } from "@/domain/events/types";
import { award } from "./rewards";
import { countPlayedMatches, countWonMatches } from "./matchCounts";

export interface ServiceResult<T> {
  ok: boolean;
  status: number;
  error?: string;
  data?: T;
}

const ok = <T,>(data: T): ServiceResult<T> => ({ ok: true, status: 200, data });
const fail = (status: number, error: string): ServiceResult<never> => ({ ok: false, status, error });

// ───────────────────────────── El evento vigente ─────────────────────────────

interface EventRow {
  id: string; name: string; type: string | null; region: string | null;
  status: string | null; start_date: string | null; end_date: string | null; source: string;
}

export interface LiveEvent extends EventShape {
  name: string;
  isDemo: boolean;
  phase: EventPhase;
  startDate: string | null;
  endDate: string | null;
}

/**
 * El evento que le importa al jugador ahora mismo.
 *
 * La prioridad es la del jugador, no la de la base de datos: primero lo que está a punto de
 * cerrarse, después lo que está en marcha, después lo siguiente que empieza y por último lo
 * que acaba de terminar pero todavía se puede cobrar. Un evento `archived` no se devuelve
 * nunca: ya no hay nada que hacer con él.
 *
 * Se leen varias filas y se ordenan aquí en vez de pedirle el orden a Postgres porque la
 * fase NO es una columna: se calcula. Pedirle a la base de datos que ordene por algo que no
 * guarda es la clase de atajo que obliga después a duplicar la regla.
 */
export async function getLiveEvent(
  admin: SupabaseClient, now = Date.now(),
): Promise<LiveEvent | null> {
  const { data } = await admin
    .from("events")
    .select("id, name, type, region, status, start_date, end_date, source")
    .order("start_date", { ascending: false })
    .limit(24);

  const rows = (data ?? []) as EventRow[];
  const RANK: Record<EventPhase, number> = { ending: 0, live: 1, upcoming: 2, completed: 3, archived: 99 };

  const candidates = rows
    .map((r) => {
      const timing: EventTiming = { status: r.status, startDate: r.start_date, endDate: r.end_date };
      return { row: r, phase: eventPhase(timing, now) };
    })
    .filter((c) => c.phase !== "archived")
    .sort((a, b) => {
      const d = RANK[a.phase] - RANK[b.phase];
      if (d !== 0) return d;
      // Dentro de la misma fase, lo más cercano en el tiempo primero.
      const ta = new Date(a.row.start_date ?? 0).getTime();
      const tb = new Date(b.row.start_date ?? 0).getTime();
      return a.phase === "upcoming" ? ta - tb : tb - ta;
    });

  const best = candidates[0];
  if (!best) return null;
  return {
    id: best.row.id, name: best.row.name, type: best.row.type, region: best.row.region,
    isDemo: best.row.source === "demo",
    phase: best.phase, startDate: best.row.start_date, endDate: best.row.end_date,
  };
}

async function loadEvent(admin: SupabaseClient, eventId: string, now: number): Promise<LiveEvent | null> {
  const { data } = await admin
    .from("events").select("id, name, type, region, status, start_date, end_date, source")
    .eq("id", eventId).maybeSingle();
  const r = data as EventRow | null;
  if (!r) return null;
  return {
    id: r.id, name: r.name, type: r.type, region: r.region, isDemo: r.source === "demo",
    phase: eventPhase({ status: r.status, startDate: r.start_date, endDate: r.end_date }, now),
    startDate: r.start_date, endDate: r.end_date,
  };
}

// ───────────────────────────── Progreso, contado al vuelo ─────────────────────────────

export type EventMetrics = Record<EventMetric, number>;

const ZERO: EventMetrics = {
  event_picks_made: 0, event_picks_correct: 0, event_pickem_points: 0,
  event_duels_played: 0, event_duels_won: 0, event_packs_opened: 0,
};

/**
 * La ventana del evento, en ISO, para acotar los recuentos.
 *
 * Sin `start_date` no hay ventana y las métricas temporales (duelos, sobres) se quedan a
 * cero en lugar de contar toda la historia del jugador. Es deliberado: contar desde el
 * principio de los tiempos convertiría un desafío de evento en un logro retroactivo que se
 * cobra el primer día, que es justo lo que un desafío no debe ser.
 */
function windowOf(ev: LiveEvent, now: number): { from: string; to: string } | null {
  if (!ev.startDate) return null;
  const end = ev.endDate ? Math.min(new Date(ev.endDate).getTime(), now) : now;
  return { from: ev.startDate, to: new Date(end).toISOString() };
}

/**
 * Cuánto lleva el jugador en este evento.
 *
 * Ni un solo contador nuevo: cada cifra sale de la tabla donde el hecho ya está escrito.
 * `pickem_scores` para puntos y aciertos, `duel_matches` para las partidas y `economy_ops`
 * para los sobres —que es exacto y está fechado, mientras que `profiles.packs_opened` es un
 * total acumulado y no se puede acotar a una ventana—.
 */
export async function eventMetricsFor(
  admin: SupabaseClient, userId: string, ev: LiveEvent, now = Date.now(),
): Promise<EventMetrics> {
  const win = windowOf(ev, now);
  const out: EventMetrics = { ...ZERO };

  const { data: pe } = await admin
    .from("pickem_events").select("id").eq("event_id", ev.id)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  const pickemId = (pe as { id: string } | null)?.id ?? null;

  const jobs: Promise<void>[] = [];

  if (pickemId) {
    jobs.push((async () => {
      const { data: score } = await admin
        .from("pickem_scores").select("points, correct")
        .eq("user_id", userId).eq("pickem_event_id", pickemId).maybeSingle();
      const s = score as { points: number; correct: number } | null;
      out.event_pickem_points = s?.points ?? 0;
      out.event_picks_correct = s?.correct ?? 0;
    })());

    jobs.push((async () => {
      const { data: sub } = await admin
        .from("pickem_submissions").select("id")
        .eq("user_id", userId).eq("pickem_event_id", pickemId).maybeSingle();
      const submissionId = (sub as { id: string } | null)?.id ?? null;
      if (!submissionId) return;
      const { count } = await admin
        .from("pickem_answers").select("id", { count: "exact", head: true })
        .eq("submission_id", submissionId);
      out.event_picks_made = count ?? 0;
    })());
  }

  if (win) {
    jobs.push((async () => {
      // CORE GAME LOOP · «partidas que cuentan» (`matchCounts`): PvE + ranked en los dos asientos; ni privadas, ni
      // torneos, ni Draft (Fase 39).
      const { count } = await countPlayedMatches(admin, userId, { column: "created_at", from: win.from, to: win.to });
      out.event_duels_played = count ?? 0;
    })());

    jobs.push((async () => {
      const { count } = await countWonMatches(admin, userId, { column: "created_at", from: win.from, to: win.to });
      out.event_duels_won = count ?? 0;
    })());

    jobs.push((async () => {
      const { count } = await admin
        .from("economy_ops").select("ref", { count: "exact", head: true })
        .eq("user_id", userId).eq("kind", "open_pack")
        .gte("created_at", win.from).lte("created_at", win.to);
      out.event_packs_opened = count ?? 0;
    })());
  }

  await Promise.all(jobs);
  return out;
}

// ───────────────────────────── La vista ─────────────────────────────

export interface EventChallengeView {
  id: string;
  label: string;
  description: string;
  goal: number;
  progress: number;
  complete: boolean;
  claimed: boolean;
  /** ¿Se puede pulsar AHORA? Completo, sin reclamar y dentro de la ventana. */
  claimable: boolean;
  reward: Reward;
}

export interface EventView {
  event: {
    id: string; name: string; type: string | null;
    phase: EventPhase; phaseLabel: string;
    startDate: string | null; endDate: string | null;
    /** Cuándo se cierra la puerta de reclamación, en ISO. */
    claimClosesAt: string | null;
    /** Milisegundos hasta el próximo cambio de fase, para el contador de la interfaz. */
    msUntilNextPhase: number | null;
    isDemo: boolean;
  };
  setId: string;
  setLabel: string;
  challenges: EventChallengeView[];
  /** Todo lo que reparte el evento, para la vitrina «qué puedo ganar». */
  totalReward: Reward;
  /** Lo ya cobrado, para «qué llevas». */
  claimedCount: number;
  /** El Pick'em del evento, si lo tiene: es la actividad principal. */
  pickem: { id: string; status: string; openQuestions: number; answered: number } | null;
}

function viewOf(
  def: EventChallengeDef, metrics: EventMetrics, claimed: Set<string>, phase: EventPhase,
): EventChallengeView {
  const progress = Math.min(metrics[def.metric] ?? 0, def.goal);
  const complete = (metrics[def.metric] ?? 0) >= def.goal;
  const isClaimed = claimed.has(def.id);
  return {
    id: def.id, label: def.label, description: def.description, goal: def.goal,
    progress, complete, claimed: isClaimed,
    claimable: complete && !isClaimed && canClaimInPhase(phase),
    reward: def.reward,
  };
}

/** Ids de desafío ya reclamados de ESTE evento. */
async function claimedFor(admin: SupabaseClient, userId: string, eventId: string): Promise<Set<string>> {
  const prefix = challengeRef(eventId, "");
  const { data } = await admin
    .from("user_achievements").select("achievement_id")
    .eq("user_id", userId).like("achievement_id", `${prefix}%`);
  const out = new Set<string>();
  for (const r of (data ?? []) as { achievement_id: string }[]) {
    out.add(r.achievement_id.slice(prefix.length));
  }
  return out;
}

export async function getEventView(
  admin: SupabaseClient, userId: string, now = Date.now(),
): Promise<ServiceResult<EventView | null>> {
  const ev = await getLiveEvent(admin, now);
  if (!ev) return ok(null);
  return buildEventView(admin, userId, ev, now);
}

/**
 * FASE 30 · la MISMA vista de desafíos, pero para UN evento concreto (el Event Hub). Mismas
 * definiciones (`CHALLENGE_SETS`), mismos hechos, mismo `claimEventChallenge`: no hay un segundo
 * motor de objetivos. Un evento archivado sigue enseñando sus desafíos, ya sin poder reclamar.
 */
export async function getEventViewFor(
  admin: SupabaseClient, userId: string, eventId: string, now = Date.now(),
): Promise<ServiceResult<EventView | null>> {
  const ev = await loadEvent(admin, eventId, now);
  if (!ev) return ok(null);
  return buildEventView(admin, userId, ev, now);
}

async function buildEventView(
  admin: SupabaseClient, userId: string, ev: LiveEvent, now: number,
): Promise<ServiceResult<EventView | null>> {
  const [metrics, claimed, pickem] = await Promise.all([
    eventMetricsFor(admin, userId, ev, now),
    claimedFor(admin, userId, ev.id),
    loadPickem(admin, userId, ev.id, now),
  ]);

  const set = challengeSetFor(ev);
  const challenges = set.challenges.map((c) => viewOf(c, metrics, claimed, ev.phase));
  const closes = claimClosesAt({ status: null, startDate: ev.startDate, endDate: ev.endDate });

  return ok({
    event: {
      id: ev.id, name: ev.name, type: ev.type,
      phase: ev.phase, phaseLabel: PHASE_LABEL[ev.phase],
      startDate: ev.startDate, endDate: ev.endDate,
      claimClosesAt: closes === null ? null : new Date(closes).toISOString(),
      msUntilNextPhase: msUntilNextPhase(
        { status: null, startDate: ev.startDate, endDate: ev.endDate }, now,
      ),
      isDemo: ev.isDemo,
    },
    setId: set.id,
    setLabel: set.label,
    challenges,
    totalReward: totalReward(set.challenges),
    claimedCount: challenges.filter((c) => c.claimed).length,
    pickem,
  });
}

async function loadPickem(
  admin: SupabaseClient, userId: string, eventId: string, now: number,
): Promise<EventView["pickem"]> {
  const { data: pe } = await admin
    .from("pickem_events").select("id, status").eq("event_id", eventId)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  const row = pe as { id: string; status: string } | null;
  if (!row) return null;

  const { data: qs } = await admin
    .from("pickem_questions").select("id, locks_at").eq("pickem_event_id", row.id);
  const open = ((qs ?? []) as { id: string; locks_at: string }[])
    .filter((q) => new Date(q.locks_at).getTime() > now);

  const { data: sub } = await admin
    .from("pickem_submissions").select("id")
    .eq("user_id", userId).eq("pickem_event_id", row.id).maybeSingle();
  const submissionId = (sub as { id: string } | null)?.id ?? null;
  let answered = 0;
  if (submissionId) {
    const { count } = await admin
      .from("pickem_answers").select("id", { count: "exact", head: true })
      .eq("submission_id", submissionId);
    answered = count ?? 0;
  }

  return { id: row.id, status: row.status, openQuestions: open.length, answered };
}

// ───────────────────────────── Cobrar ─────────────────────────────

export interface ClaimResult {
  challengeId: string;
  reward: Reward;
  credits: number;
  /** `false` si la clave ya existía: no se pagó dos veces, y está bien. */
  applied: boolean;
}

/**
 * Cobra un desafío de evento.
 *
 * Las cinco puertas, en este orden, y el orden importa:
 *
 *   1. El evento existe.
 *   2. La FASE permite cobrar. Aquí se cierra el agujero: da igual lo que crea el cliente,
 *      un evento archivado no paga.
 *   3. El desafío pertenece a ESE evento. Un id de otro conjunto no vale.
 *   4. El progreso REAL llega a la meta. Contado ahora, no enviado por nadie.
 *   5. No estaba ya reclamado.
 *
 * Y después se paga por `award()` —que además es idempotente por `ref`—, y solo entonces se
 * escribe el registro. Ese orden es el correcto: si se registrara primero y el pago fallara,
 * el desafío quedaría marcado como cobrado sin haber pagado nada. Al revés, un fallo entre
 * los dos pasos deja un reintento que vuelve a llamar a `award()`, que ya no paga por la
 * clave, y completa el registro que faltaba.
 */
export async function claimEventChallenge(
  admin: SupabaseClient, userId: string, eventId: string, challengeId: string, now = Date.now(),
): Promise<ServiceResult<ClaimResult>> {
  const ev = await loadEvent(admin, eventId, now);
  if (!ev) return fail(404, "Ese evento no existe");

  if (!canClaimInPhase(ev.phase)) {
    return fail(409, ev.phase === "archived"
      ? "El plazo para reclamar las recompensas de este evento ya se ha cerrado"
      : "Este evento todavía no ha empezado");
  }

  const def = challengeById(ev, challengeId);
  if (!def) return fail(404, "Ese desafío no pertenece a este evento");

  const metrics = await eventMetricsFor(admin, userId, ev, now);
  const progress = metrics[def.metric] ?? 0;
  if (progress < def.goal) {
    return fail(409, `Todavía no: llevas ${progress} de ${def.goal}`);
  }

  const ref = challengeRef(ev.id, def.id);

  const { data: already } = await admin
    .from("user_achievements").select("achievement_id")
    .eq("user_id", userId).eq("achievement_id", ref).maybeSingle();
  if (already) return fail(409, "Ya has reclamado ese desafío");

  const outcome = await award(admin, {
    userId, ref, reason: `event_challenge:${ev.id}:${def.id}`, reward: def.reward,
  });

  await admin.from("user_achievements")
    .upsert({ user_id: userId, achievement_id: ref }, { onConflict: "user_id,achievement_id" });

  return ok({
    challengeId: def.id, reward: def.reward, credits: outcome.credits, applied: outcome.applied,
  });
}

/** Reexportado para el ciclo y las verificaciones: saber si un evento admite participación. */
export { isRunning };
