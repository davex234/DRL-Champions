/**
 * ESPORTS AUTO-SYNC · EL CORE (Fase 24.6) — `runEsportsSync()`.
 *
 * ────────────────────────── UNA SOLA LÓGICA ──────────────────────────
 *
 *                       runEsportsSync()
 *                            ▲
 *               ┌────────────┴────────────┐
 *          manual trigger           scheduled trigger
 *     (CLI, /api/esports/sync,   (cron / systemd timer →
 *      /api/internal/… manual)     /api/internal/esports/sync
 *                                   o `scripts/esports-autosync.ts`)
 *
 * El trigger decide CUÁNDO; esto decide QUÉ. Por debajo, cada evento se sincroniza con el
 * pipeline canónico que ya existía y ya estaba validado: importer-vlr → `snapshotToSource` →
 * `syncTournament` → `runPickemLifecycle` → `app_score_pickem_event` → `services/rewards`. No
 * hay un importador automático paralelo: hay una capa que elige eventos, protege la ejecución y
 * corta lo que no debe escribirse.
 *
 * ────────────────────────── LO QUE AÑADE ESTA CAPA ──────────────────────────
 *
 *   · Descubrimiento de eventos elegibles desde la base de datos (sin que nadie abra /pickems).
 *   · Política de frecuencia por clase de evento, backoff y jitter (`policy.ts`).
 *   · Single-flight con lease en `sync_state` (`lock.ts`).
 *   · Timeout, reintento solo transitorio y host allowlist (`sourceRef.ts`).
 *   · Validación del payload, transiciones de estado y corte ante fuente sospechosa
 *     (`validate.ts`): nunca se borra ni se regresa un resultado por una página rara.
 *   · Pick'ems solo cuando hace falta, con marcador de convergencia para recuperar de un crash.
 *   · Dry run: obtiene, normaliza, compara e informa — y no escribe absolutamente nada.
 *   · Salud persistida y avisos con código (SYNC_FAILED, SOURCE_PARSE_FAILED, …).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawSnapshot } from "@/importer";
import { importVlrTournament } from "@/importer-vlr";
import { snapshotToSource } from "@/lib/esports/sync/vlrSnapshotSource";
import { playerRow } from "@/lib/esports/sync/mappers";
import { syncTournament, type SyncResult as TournamentSyncResult } from "@/lib/esports/sync/orchestrator";
import { setSyncState, logNotification } from "@/lib/esports/sync/writers";
import type { CompetitiveSource, RawMatch } from "@/lib/esports/sync/source";
import { normalizeStatus } from "@/lib/esports/sync/source";
import type { EsportsAutoSyncConfig } from "./config";
import {
  planSyncRun, type EventClass, type EventSnapshotForPolicy, type EventSyncDecision, type EventSyncMemory,
} from "./policy";
import { diffMatches, isSuspiciousShrink, resultsFingerprint, type KnownMatch, type MatchDiff } from "./validate";
import { createDbLeaseLock, type SyncLock } from "./lock";
import { readHealth, nextHealth, writeHealth, type EsportsSyncHealth, type SyncRunSummary } from "./health";
import {
  resolveSourceRef, createTimedFetcher, classifySourceError, type SourceRef, type SourceErrorKind,
} from "./sourceRef";
import { nullLogger, type SyncLogger } from "./log";

/* ═══════════════════════════════ TIPOS ═══════════════════════════════ */

export type SyncMode = "manual" | "scheduled";

export interface RunOptions {
  mode: SyncMode;
  /** Obtiene, normaliza, compara e informa. NO escribe, NO corrige, NO recompensa. */
  dryRun?: boolean;
  /** Restringe el descubrimiento a estos eventos de NEXUS (ids ya validados por el trigger). */
  eventIds?: string[];
  /** Objetivos explícitos (CLI): evento NEXUS + referencia a la fuente. Se salta el descubrimiento. */
  targets?: SourceRef[];
  /** Ignora «¿toca ahora?» de la política. Por defecto: sí en manual, no en scheduled. */
  force?: boolean;
  /** Ejecutar el ciclo de Pick'ems (por defecto sí, como en el sync manual). */
  pickems?: boolean;
  runId?: string;
}

export interface RunDeps {
  /** `null` solo para un dry run «sin base de datos» (fuente → normalización → política). */
  sb: SupabaseClient | null;
  cfg: EsportsAutoSyncConfig;
  now?: () => number;
  /** Fuente inyectable (tests/QA con fixtures). Por defecto, el conector VLR con timeout y reintentos. */
  fetchSnapshot?: (ref: SourceRef) => Promise<{ snapshot: RawSnapshot; warnings: string[] }>;
  lock?: SyncLock;
  logger?: SyncLogger;
  rng?: () => number;
  owner?: string;
  /** Fase 24.8 · quién ejecuta (p. ej. `worker-vps`, `pc-manual`): viaja a la salud y al log. */
  origin?: string;
}

export type NotificationLevel = "info" | "warn" | "error";
export type NotificationCode =
  | "SYNC_FAILED" | "SOURCE_PARSE_FAILED" | "SOURCE_SUSPICIOUS" | "STRUCTURE_CONFLICT"
  | "MATCH_REGRESSION_REJECTED" | "RESULT_CORRECTED" | "SCORING_FAILED" | "LOCK_STALE_RECOVERED";

export interface SyncNotification { level: NotificationLevel; code: NotificationCode; message: string }

export interface EventSyncReport {
  eventId: string;
  vlrEventId: string | null;
  name: string | null;
  class: EventClass | null;
  status: "synced" | "unchanged" | "skipped" | "failed" | "dry-run";
  reason?: string;
  errorKind?: SourceErrorKind | "db";
  matches: {
    known: number; source: number; unchanged: number; created: number; updated: number;
    finished: number; invalid: number; rejected: number; corrections: number;
  };
  bracket: { confirmed: number; qualification: number; unknown: number; conflicts: number; skipped?: "pre-0045" };
  pickems: {
    needed: boolean; ran: boolean; created: number; resolved: number; corrected: number;
    scored: boolean; usersScored: number; notes: string[];
  };
  identityIssues: number;
  durationMs: number;
  policy?: EventSyncDecision;
  warnings: string[];
  /** Avisos que se han registrado (o, en dry run, que SE REGISTRARÍAN). */
  notifications: SyncNotification[];
}

export interface EsportsSyncRunResult {
  runId: string;
  mode: SyncMode;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Por qué no se hizo nada, cuando aplica. */
  skipped?: "disabled" | "locked" | "no-db";
  lock: { acquired: boolean; recoveredStale: boolean; holder?: string | null };
  eventsChecked: number;
  eventsDue: number;
  eventsSynced: number;
  eventsChanged: number;
  eventsFailed: number;
  eventsSkipped: number;
  matchesChecked: number;
  matchesCreated: number;
  matchesUpdated: number;
  matchesFinished: number;
  matchesRejected: number;
  matchesInvalid: number;
  bracketChanges: number;
  qualificationsResolved: number;
  pickemsScored: number;
  pickemsCorrected: number;
  usersScored: number;
  errors: string[];
  events: EventSyncReport[];
  nextDueAt: string | null;
  health: EsportsSyncHealth | null;
}

/* ═══════════════════════════════ UTILIDADES ═══════════════════════════════ */

interface EventRow {
  id: string; name: string | null; status: string | null; start_date: string | null; end_date: string | null;
  source: string | null; vlr_url: string | null;
}

const norm = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

async function loadCatalogs(sb: SupabaseClient): Promise<{ agents: Map<string, string>; maps: Map<string, string> }> {
  const agents = new Map<string, string>();
  const maps = new Map<string, string>();
  const ag = await sb.from("agents").select("id,name");
  for (const a of ((ag.data ?? []) as { id: string; name: string }[])) { agents.set(norm(a.name), a.id); agents.set(norm(a.id), a.id); }
  const mp = await sb.from("maps").select("id,name");
  for (const m of ((mp.data ?? []) as { id: string; name: string }[])) { maps.set(norm(m.name), m.id); maps.set(norm(m.id), m.id); }
  return { agents, maps };
}

const BENIGN_NOTE = /^(Pick'em creado|sin preguntas resueltas|\d+ etiqueta\(s\) refrescada\(s\)|\d+ resultado\(s\) rectificado\(s\).*)$/;

async function runPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(size, queue.length)) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

function emptyReport(eventId: string, vlrEventId: string | null): EventSyncReport {
  return {
    eventId, vlrEventId, name: null, class: null, status: "skipped",
    matches: { known: 0, source: 0, unchanged: 0, created: 0, updated: 0, finished: 0, invalid: 0, rejected: 0, corrections: 0 },
    bracket: { confirmed: 0, qualification: 0, unknown: 0, conflicts: 0 },
    pickems: { needed: false, ran: false, created: 0, resolved: 0, corrected: 0, scored: false, usersScored: 0, notes: [] },
    identityIssues: 0, durationMs: 0, warnings: [], notifications: [],
  };
}

function defaultFetchSnapshot(cfg: EsportsAutoSyncConfig, logger: SyncLogger) {
  const fetcher = createTimedFetcher({
    timeoutMs: cfg.timeoutMs, retry: cfg.retry,
    onAttempt: (i) => { if (i.error) logger.warn("source_attempt_failed", { url: i.url, attempt: i.attempt, error: i.error }); },
  });
  return async (ref: SourceRef) => {
    const out = await importVlrTournament(ref.url, {
      fetcher, politeDelayMs: cfg.politeDelayMs, maxMatchPages: cfg.maxMatchPages, includeMatchDetails: true,
    });
    return { snapshot: out.snapshot, warnings: out.warnings };
  };
}

/* ═══════════════════════════════ UN EVENTO ═══════════════════════════════ */

interface EventContext {
  ref: SourceRef;
  row: EventRow | null;
  decision?: EventSyncDecision;
}

async function syncOneEvent(
  ctx: EventContext, deps: Required<Pick<RunDeps, "cfg" | "now" | "fetchSnapshot" | "logger">> & { sb: SupabaseClient | null },
  opts: RunOptions, catalogs: { agents: Map<string, string>; maps: Map<string, string> },
): Promise<EventSyncReport> {
  const { ref, row } = ctx;
  const { sb, cfg, now, logger } = deps;
  const t0 = now();
  const dryRun = !!opts.dryRun;
  const report = emptyReport(ref.eventId, ref.vlrEventId);
  report.name = row?.name ?? null;
  report.class = ctx.decision?.class ?? null;
  report.policy = ctx.decision;
  const notify = (level: NotificationLevel, code: NotificationCode, message: string) => {
    report.notifications.push({ level, code, message });
  };
  const finish = (status: EventSyncReport["status"], reason?: string): EventSyncReport => {
    report.status = status;
    if (reason) report.reason = reason;
    report.durationMs = now() - t0;
    logger[status === "failed" ? "error" : "info"]("event_sync", {
      run_mode: opts.mode, dry_run: dryRun, event: ref.eventId, vlr_event: ref.vlrEventId, class: report.class,
      status, reason, matches_changed: report.matches.created + report.matches.updated,
      matches_finished: report.matches.finished, rejected: report.matches.rejected, invalid: report.matches.invalid,
      pickems_ran: report.pickems.ran, scored: report.pickems.scored, duration_ms: report.durationMs,
    });
    return report;
  };

  // 1. Lo conocido (para comparar y para no perder nada por una fuente rara).
  let known: KnownMatch[] = [];
  let prevState: { status: string | null; cursor: string | null } = { status: null, cursor: null };
  if (sb) {
    const k = await sb.from("matches").select("id, status, score_a, score_b, winner_team_id, start_time").eq("event_id", ref.eventId);
    if (k.error) { report.errorKind = "db"; notify("error", "SYNC_FAILED", `${ref.eventId}: lectura de partidos: ${k.error.message}`); return finish("failed", k.error.message); }
    known = (k.data ?? []) as KnownMatch[];
    const st = await sb.from("sync_state").select("status, cursor").eq("id", `vlr:event:${ref.eventId}`).maybeSingle();
    prevState = (st.data as { status: string; cursor: string | null } | null) ?? { status: null, cursor: null };
  }
  report.matches.known = known.length;

  // 2. La fuente (con timeout, reintento transitorio y host allowlist dentro del fetcher).
  let snapshot: RawSnapshot;
  let warnings: string[];
  try {
    const out = await deps.fetchSnapshot(ref);
    snapshot = out.snapshot; warnings = out.warnings;
  } catch (e) {
    const err = classifySourceError(e);
    report.errorKind = err.kind;
    notify("error", err.kind === "parse" ? "SOURCE_PARSE_FAILED" : "SYNC_FAILED", `${ref.eventId}: fuente ${err.kind}: ${err.message}`);
    return finish("failed", `fuente (${err.kind}): ${err.message}`);
  }
  report.warnings = warnings;
  report.name = snapshot.tournament.name ?? report.name;

  // 3. Normalización con el adaptador canónico (identidades, catálogos, estructura).
  const adapted = snapshotToSource(snapshot, { eventId: ref.eventId, agents: catalogs.agents, maps: catalogs.maps, sourceUrl: ref.url });
  report.identityIssues = adapted.issues.length;
  const incoming = await adapted.source.getMatches(ref.eventId);
  report.matches.source = incoming.length;

  // 4. Corte de seguridad: una lista vacía o encogida no borra ni reescribe nada.
  const suspicious = isSuspiciousShrink(known.length, incoming.length, cfg);
  if (suspicious) {
    report.errorKind = "parse";
    notify("error", "SOURCE_SUSPICIOUS", `${ref.eventId}: ${suspicious}; no se escribe nada`);
    return finish("failed", suspicious);
  }

  // 5. Diferencia y transiciones (lo rechazado conserva lo que había).
  const diff: MatchDiff = diffMatches(known, incoming);
  report.matches.unchanged = diff.unchanged;
  report.matches.created = diff.created.length;
  report.matches.updated = diff.updated.length;
  report.matches.finished = diff.finished.length;
  report.matches.invalid = diff.invalid.length;
  report.matches.rejected = diff.rejected.length;
  report.matches.corrections = diff.corrections.length;
  for (const r of diff.rejected) notify("warn", "MATCH_REGRESSION_REJECTED", `${ref.eventId}/${r.matchId}: ${r.reason}`);
  for (const c of diff.corrections) notify("warn", "RESULT_CORRECTED", `${ref.eventId}/${c.matchId}: ${c.from} → ${c.to}`);

  const accepted: RawMatch[] = diff.accepted;
  const acceptedIds = new Set(accepted.map((m) => m.id));
  const structured = accepted.filter((m) => m.progression?.confidence === "CONFIRMED"
    && (!m.progression.winnerTo || acceptedIds.has(m.progression.winnerTo.matchId))
    && (!m.progression.loserTo || acceptedIds.has(m.progression.loserTo.matchId)));
  report.bracket.confirmed = structured.length;
  report.bracket.qualification = structured.filter((m) => m.progression?.winnerQualifies).length;
  report.bracket.unknown = accepted.length - structured.length;
  report.bracket.conflicts = warnings.filter((w) => /conflicto/i.test(w)).length;
  if (report.bracket.conflicts > 0) notify("warn", "STRUCTURE_CONFLICT", `${ref.eventId}: ${report.bracket.conflicts} conflicto(s) entre cuadro y resultados en la fuente`);

  // 6. ¿Hace falta el ciclo de Pick'ems? Solo si algo relevante cambió o si la pasada anterior
  //    no llegó a completarlo (marcador de convergencia en `sync_state.cursor`).
  const fingerprint = resultsFingerprint(accepted);
  const changed = diff.created.length + diff.updated.length + diff.corrections.length > 0;
  const previousIncomplete = prevState.status !== "ok" || prevState.cursor !== fingerprint;
  const needsLifecycle = opts.pickems !== false && (known.length === 0 || changed || previousIncomplete);
  report.pickems.needed = needsLifecycle;

  if (dryRun) {
    return finish("dry-run", changed ? `${diff.created.length} nuevo(s), ${diff.updated.length} cambio(s)` : "sin cambios");
  }
  if (!sb) return finish("skipped", "sin base de datos");

  /*
   * SIN CAMBIOS Y SIN CICLO PENDIENTE → cero escrituras. El pipeline canónico es idempotente por
   * UPSERT, pero reescribir lo mismo cada dos minutos no aporta nada y sí carga la base de datos.
   * Lo que no cambia en estado/marcador/ganador no se toca; el marcador de convergencia dice que
   * los Pick'ems ya están al día. (Un evento nunca sincronizado siempre escribe.)
   */
  if (!changed && !needsLifecycle && known.length > 0 && diff.rejected.length === 0) {
    return finish("unchanged", "sin cambios en la fuente");
  }

  // 7. Escritura por el pipeline canónico, con la fuente acotada a lo aceptado.
  const source: CompetitiveSource = {
    ...adapted.source,
    getMatches: async () => accepted,
    getMatchDetail: async (id) => accepted.find((m) => m.id === id) ?? null,
  };
  let r: TournamentSyncResult;
  try {
    r = await syncTournament(source, ref.eventId, sb, {
      players: adapted.players.map(playerRow),
      pickems: needsLifecycle,
      lifecycle: { reconcileMatchIds: diff.corrections.map((c) => c.matchId) },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    report.errorKind = "db";
    notify("error", "SYNC_FAILED", `${ref.eventId}: ${msg}`);
    return finish("failed", msg);
  }
  if (r.structure?.skipped) report.bracket.skipped = r.structure.skipped;
  if (!r.ok) {
    report.errorKind = "db";
    notify("error", "SYNC_FAILED", `${ref.eventId}: ${r.error ?? "sync sin ok"}`);
    return finish("failed", r.error ?? "sync sin ok");
  }
  if (r.pickem) {
    report.pickems.ran = true;
    report.pickems.created = r.pickem.created;
    report.pickems.resolved = r.pickem.resolved;
    report.pickems.corrected = r.pickem.corrected;
    report.pickems.scored = r.pickem.scored;
    report.pickems.usersScored = r.pickem.usersScored;
    report.pickems.notes = r.pickem.notes;
    /*
     * MARCADOR DE CONVERGENCIA. Solo se escribe cuando el ciclo ha corrido ENTERO y sin quejas:
     * si el corrector falló (nota no benigna), el marcador se queda atrás y la siguiente pasada
     * vuelve a intentarlo aunque la fuente no haya cambiado. Es lo que hace que un crash entre
     * «resultados escritos» y «recompensas concedidas» se recupere solo.
     */
    const lifecycleClean = r.pickem.notes.every((n) => BENIGN_NOTE.test(n));
    if (lifecycleClean) await setSyncState(sb, `vlr:event:${ref.eventId}`, { cursor: fingerprint });
  }
  const scoringProblem = report.pickems.ran && diff.finished.length > 0 && !report.pickems.scored && report.pickems.resolved === 0;
  if (scoringProblem) notify("error", "SCORING_FAILED", `${ref.eventId}: ${diff.finished.length} partido(s) terminado(s) y ninguna pregunta resuelta ni corregida`);

  return finish(changed || report.pickems.ran ? "synced" : "unchanged", changed ? undefined : "sin cambios en la fuente");
}

/* ═══════════════════════════════ LA PASADA ═══════════════════════════════ */

// Sin clases de caracteres con dos puntos entre corchetes en el código (ni en comentarios): Tailwind
// escanea src/ y toma esa forma por una clase arbitraria, y el build de CSS revienta.
const newRunId = (now: number): string => `${new Date(now).toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;

export async function runEsportsSync(deps: RunDeps, opts: RunOptions): Promise<EsportsSyncRunResult> {
  const now = deps.now ?? (() => Date.now());
  const logger = deps.logger ?? nullLogger;
  const cfg = deps.cfg;
  const t0 = now();
  const runId = opts.runId ?? newRunId(t0);
  const dryRun = !!opts.dryRun;
  const force = opts.force ?? opts.mode === "manual";
  const sb = deps.sb;

  const result: EsportsSyncRunResult = {
    runId, mode: opts.mode, dryRun, startedAt: new Date(t0).toISOString(), finishedAt: "", durationMs: 0,
    lock: { acquired: false, recoveredStale: false },
    eventsChecked: 0, eventsDue: 0, eventsSynced: 0, eventsChanged: 0, eventsFailed: 0, eventsSkipped: 0,
    matchesChecked: 0, matchesCreated: 0, matchesUpdated: 0, matchesFinished: 0, matchesRejected: 0, matchesInvalid: 0,
    bracketChanges: 0, qualificationsResolved: 0, pickemsScored: 0, pickemsCorrected: 0, usersScored: 0,
    errors: [], events: [], nextDueAt: null, health: null,
  };
  const done = (): EsportsSyncRunResult => {
    result.finishedAt = new Date(now()).toISOString();
    result.durationMs = now() - t0;
    logger.info("run", {
      run_id: runId, mode: opts.mode, origin: deps.origin, dry_run: dryRun, skipped: result.skipped, events_checked: result.eventsChecked,
      events_due: result.eventsDue, events_synced: result.eventsSynced, events_changed: result.eventsChanged,
      events_failed: result.eventsFailed, matches_finished: result.matchesFinished, pickems_scored: result.pickemsScored,
      duration_ms: result.durationMs, status: result.skipped ? "skipped" : result.eventsFailed > 0 ? (result.eventsSynced > 0 ? "partial" : "failed") : "success",
    });
    return result;
  };

  // KILL SWITCH — el scheduled no ejecuta nada sin activación explícita. El manual sigue funcionando.
  if (opts.mode === "scheduled" && !cfg.enabled) {
    result.skipped = "disabled";
    return done();
  }

  const explicitTargets = opts.targets ?? [];
  if (!sb && !(dryRun && explicitTargets.length)) {
    result.skipped = "no-db";
    result.errors.push("SYNC_FAILED: Supabase admin no configurado");
    return done();
  }

  // SINGLE-FLIGHT — el dry run no toma el lock (no escribe nada, ni siquiera el lease).
  const owner = deps.owner ?? `${runId}`;
  const lock = deps.lock ?? (sb ? createDbLeaseLock(sb) : null);
  if (!dryRun && lock) {
    const got = await lock.acquire(owner, cfg.lockTtlMs, now());
    if (!got.acquired) {
      result.skipped = "locked";
      result.lock = { acquired: false, recoveredStale: false, holder: got.holder };
      logger.warn("lock_busy", { run_id: runId, holder: got.holder, held_since: got.heldSince });
      return done();
    }
    result.lock = { acquired: true, recoveredStale: got.recoveredStale };
    if (got.recoveredStale) logger.warn("lock_stale_recovered", { run_id: runId });
  }

  try {
    const fetchSnapshot = deps.fetchSnapshot ?? defaultFetchSnapshot(cfg, logger);
    const health = sb ? await readHealth(sb) : null;
    const memory: Record<string, EventSyncMemory> = { ...(health?.events ?? {}) };
    const catalogs = sb ? await loadCatalogs(sb) : { agents: new Map<string, string>(), maps: new Map<string, string>() };

    // DESCUBRIMIENTO — desde la base de datos, sin depender de ningún usuario.
    const contexts: EventContext[] = [];
    let nextDueAt: number | null = null;
    if (explicitTargets.length) {
      const rowsById = new Map<string, EventRow>();
      if (sb) {
        const ev = await sb.from("events").select("id, name, status, start_date, end_date, source, vlr_url").in("id", explicitTargets.map((t) => t.eventId));
        for (const r of ((ev.data ?? []) as EventRow[])) rowsById.set(r.id, r);
      }
      for (const t of explicitTargets) contexts.push({ ref: t, row: rowsById.get(t.eventId) ?? null });
      result.eventsChecked = contexts.length;
      result.eventsDue = contexts.length;
    } else if (sb) {
      let q = sb.from("events").select("id, name, status, start_date, end_date, source, vlr_url").eq("source", "vlr");
      if (opts.eventIds?.length) q = q.in("id", opts.eventIds);
      const ev = await q;
      if (ev.error) throw new Error(`eventos: ${ev.error.message}`);
      const rows = (ev.data ?? []) as EventRow[];
      result.eventsChecked = rows.length;
      const ids = rows.map((r) => r.id);
      const byEvent = new Map<string, { status: string; startTime: string | null }[]>();
      if (ids.length) {
        const ms = await sb.from("matches").select("event_id, status, start_time").in("event_id", ids);
        for (const m of ((ms.data ?? []) as { event_id: string; status: string; start_time: string | null }[])) {
          const list = byEvent.get(m.event_id) ?? [];
          list.push({ status: m.status, startTime: m.start_time });
          byEvent.set(m.event_id, list);
        }
      }
      const snapshots: EventSnapshotForPolicy[] = rows.map((r) => ({
        id: r.id, status: r.status, startDate: r.start_date, endDate: r.end_date, matches: byEvent.get(r.id) ?? [],
      }));
      const plan = planSyncRun(snapshots, memory, now(), cfg, deps.rng);
      nextDueAt = plan.nextDueAt;
      const chosen = force ? plan.all.filter((d) => d.eligible || opts.eventIds?.includes(d.eventId)) : plan.due;
      result.eventsDue = chosen.length;
      for (const d of chosen) {
        const row = rows.find((r) => r.id === d.eventId) ?? null;
        const ref = row ? resolveSourceRef(row) : null;
        if (!ref) {
          const rep = emptyReport(d.eventId, null);
          rep.name = row?.name ?? null; rep.class = d.class; rep.policy = d;
          rep.status = "skipped"; rep.reason = "sin referencia a la fuente (ni vlr_url ni id de VLR)";
          result.events.push(rep);
          result.eventsSkipped++;
          continue;
        }
        contexts.push({ ref, row, decision: d });
      }
    }

    // SINCRONIZACIÓN — secuencial por defecto (respeto a la fuente); pool pequeño si se configura.
    const perEvent: Record<string, EventSyncMemory> = {};
    const eventDeps = { sb, cfg, now, fetchSnapshot, logger };
    await runPool(contexts, cfg.maxConcurrency, async (ctx) => {
      const rep = await syncOneEvent(ctx, eventDeps, opts, catalogs);
      result.events.push(rep);
      const at = now();
      const prev = memory[ctx.ref.eventId] ?? {};
      const failed = rep.status === "failed";
      perEvent[ctx.ref.eventId] = dryRun ? prev : {
        lastAttemptAt: at,
        lastSuccessAt: failed ? prev.lastSuccessAt ?? null : at,
        consecutiveFailures: failed ? (prev.consecutiveFailures ?? 0) + 1 : 0,
      };
      // Avisos con código: a la tabla `notifications` (0002) salvo en dry run.
      if (!dryRun && sb) {
        for (const n of rep.notifications) {
          try { await logNotification(sb, n.level, n.code, n.message); } catch { /* el aviso no tumba el sync */ }
        }
      }
    });

    // AGREGADO
    for (const rep of result.events) {
      result.matchesChecked += rep.matches.source;
      result.matchesCreated += rep.matches.created;
      result.matchesUpdated += rep.matches.updated;
      result.matchesFinished += rep.matches.finished;
      result.matchesRejected += rep.matches.rejected;
      result.matchesInvalid += rep.matches.invalid;
      result.bracketChanges += rep.bracket.confirmed;
      result.qualificationsResolved += rep.pickems.resolved;
      if (rep.pickems.scored) result.pickemsScored++;
      result.pickemsCorrected += rep.pickems.corrected;
      result.usersScored += rep.pickems.usersScored;
      if (rep.status === "failed") { result.eventsFailed++; result.errors.push(`${rep.notifications.find((n) => n.level === "error")?.code ?? "SYNC_FAILED"}: ${rep.eventId}: ${rep.reason ?? ""}`); }
      else if (rep.status === "skipped") result.eventsSkipped++;
      else {
        result.eventsSynced++;
        if (rep.matches.created + rep.matches.updated > 0) result.eventsChanged++;
      }
      for (const n of rep.notifications) {
        if (n.level === "error" && !result.errors.some((e) => e.includes(n.message))) result.errors.push(`${n.code}: ${n.message}`);
      }
      const notes = rep.pickems.notes.filter((n) => !BENIGN_NOTE.test(n));
      for (const n of notes) result.errors.push(`SCORING_FAILED: ${rep.eventId}: ${n}`);
    }
    result.nextDueAt = nextDueAt === null ? null : new Date(nextDueAt).toISOString();

    // SALUD — se persiste solo en ejecuciones reales.
    if (sb && health && !dryRun) {
      const summary: SyncRunSummary = {
        runId, mode: opts.mode, dryRun, origin: deps.origin, startedAt: result.startedAt, finishedAt: new Date(now()).toISOString(),
        durationMs: now() - t0, eventsChecked: result.eventsChecked, eventsSynced: result.eventsSynced,
        eventsChanged: result.eventsChanged, eventsFailed: result.eventsFailed,
        matchesChanged: result.matchesCreated + result.matchesUpdated, matchesFinished: result.matchesFinished,
        pickemsScored: result.pickemsScored, errors: result.errors.slice(0, 10),
      };
      const h = nextHealth(health, summary, perEvent, nextDueAt);
      result.health = h;
      try { await writeHealth(sb, h); } catch (e) { logger.error("health_write_failed", { run_id: runId, error: e instanceof Error ? e.message : String(e) }); }
    } else {
      result.health = health;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`SYNC_FAILED: ${msg}`);
    result.eventsFailed = Math.max(result.eventsFailed, 1);
    logger.error("run_failed", { run_id: runId, error: msg });
    if (sb && !dryRun) {
      try { await logNotification(sb, "error", "SYNC_FAILED", `Auto-sync ${runId}: ${msg}`); } catch { /* nada más que hacer */ }
    }
  } finally {
    if (!dryRun && lock && result.lock.acquired) {
      try { await lock.release(owner); } catch (e) { logger.error("lock_release_failed", { run_id: runId, error: e instanceof Error ? e.message : String(e) }); }
    }
  }
  return done();
}

/** Un dry run que no toca la base de datos: fuente → normalización → validación → política. */
export function isWriteFree(r: EsportsSyncRunResult): boolean {
  return r.dryRun && !r.lock.acquired;
}

export { normalizeStatus };
