/**
 * DRAFT GAUNTLET — SERVICIO CON AUTORIDAD DE SERVIDOR (Fase 39, SOLO SERVIDOR).
 *
 *   RUN (semilla de servidor) → 10 ELECCIONES (ofertas persistidas) → PLANTILLA LEGAL (validador canónico)
 *   → 5 COMBATES PvE CANÓNICOS (`services/duels`, mode DRAFT_GAUNTLET) → LIQUIDACIÓN DESDE LA PARTIDA PERSISTIDA
 *
 * FRONTERAS
 *   1. El cliente manda SOLO `actionId`, `expectedVersion` y, al elegir, `choiceId` (id público de una carta de la
 *      oferta actual). Nunca semilla, etapa, rival, resultado, lista de cartas ni usuario.
 *   2. Concurrencia optimista: toda mutación es `update … where version = esperada and status = …`. Si no toca
 *      filas, se relee: acción ya aplicada (mismo `actionId`) → misma respuesta; si no → 409 STALE_VERSION con foto.
 *   3. Una run activa por usuario (índice único parcial de 0053) y un combate por etapa (clave primaria).
 *   4. Liquidar sale SIEMPRE de `duel_matches` (resultado del motor). Ganar avanza; perder o empatar termina.
 *   5. Economía AISLADA (F72): la entrada y las recompensas pasan SOLO por `./draftEconomy` (libro mayor, claves por
 *      run/semana). Aquí no hay créditos, sobres, XP, rating, campaña ni `user_cards`; las cartas del draft no son
 *      propiedad y no tienen serial.
 *   6. Sin 0053: lectura `available: false` («DRAFT GAUNTLET TODAVÍA NO DISPONIBLE») y acciones 503.
 *   7. F72 · ENTRADA: la run se crea (índice único parcial = una activa) y DESPUÉS se cobra con clave de la run. Saldo
 *      insuficiente ⇒ la run se borra (ni run ni asiento). Una run con entrada sin pagar no admite elecciones; volver a
 *      «entrar» la cobra (misma clave ⇒ nunca dos cargos). RECOMPENSA: se fija en `state.reward` en la MISMA escritura
 *      que cierra la run y se concede después; si la concesión falla, la siguiente lectura o entrada la reintenta.
 */
import { randomInt, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog } from "@/server/catalog";
import type { CardDef, Player } from "@/domain/cards/types";
import { buildDraftPool, eligibleDataVersion, poolIsSolvable, type DraftPool } from "@/domain/draft/generate";
import {
  applyPick, createRunState, findAction, outcomeForHuman, recordAction, rivalsFor, settleTransition, toRunView,
  type DraftActionKind, type DraftMatchFact, type DraftRunRow, type DraftRunState, type PickFailure,
} from "@/domain/draft/run";
import {
  ACTIVE_STATUSES, FINAL_STATUSES, HISTORY_LIMIT, STAGE_DIFFICULTY, type DraftRunStatus, type StageOutcome,
} from "@/domain/draft/rules";
import { buildDraftSnapshot, winsOf, type DraftHistoryItem, type DraftSnapshot, type DraftUnavailableReason } from "@/domain/draft/snapshot";
import type { BotDifficulty } from "@/domain/cardgame/opponent/types";
import type { DuelMatchView } from "@/lib/duel/types";
import { isMissingSchema } from "./deckTeams";
import { abandonDraftMatch, draftDeckCheck, startDraftMatch, DRAFT_GAUNTLET_MODE, type DraftDeckCheck, type ServiceResult } from "./duels";
import { DRAFT_ECONOMY_VERSION, DRAFT_ENTRY_FEE, rewardStateFor } from "@/domain/draft/economy";
import { chargeEntry, grantRunReward, readCredits } from "./draftEconomy";

export const UNAVAILABLE_MESSAGE = "DRAFT GAUNTLET TODAVÍA NO DISPONIBLE";
/** Una run IN_MATCH sin partida creada más vieja que esto se devuelve a READY (la creación murió a medias). */
export const LAUNCH_TTL_MS = 2 * 60_000;

export type DraftErrorCode =
  | "MIGRATION_PENDING" | "POOL_UNAVAILABLE" | "NO_RUN" | "STALE_VERSION" | "WRONG_STATE" | "INVALID_PICK"
  | "DECK_INVALID" | "MATCH_FAILED" | "DB" | "INSUFFICIENT_CREDITS" | "ENTRY_PENDING" | "ENTRY_FAILED";

export interface DraftResult<T> {
  ok: boolean;
  status: number;
  error?: string;
  code?: DraftErrorCode;
  reason?: PickFailure;
  data?: T;
  /** Foto fresca para resincronizar (409/404). */
  snapshot?: DraftSnapshot;
}

const done = <T>(data: T): DraftResult<T> => ({ ok: true, status: 200, data });
const fail = (status: number, code: DraftErrorCode, error: string, extra: Partial<DraftResult<never>> = {}): DraftResult<never> =>
  ({ ok: false, status, code, error, ...extra });

export const RUN_COLS = "id, user_id, status, stage, version, seed, rules_version, data_version, state, current_match_id, created_at, updated_at, completed_at";
const MATCH_COLS = "run_id, stage, match_id, difficulty, status, result, score_you, score_rival, created_at, settled_at";
const HISTORY_COLS = "id, status, stage, created_at, completed_at";

interface RunRow extends DraftRunRow { user_id: string; seed: number | string; updated_at: string }
interface MatchRow {
  run_id: string; stage: number; match_id: string | null; difficulty: BotDifficulty; status: DraftMatchFact["status"];
  result: StageOutcome | null; score_you: number | null; score_rival: number | null; created_at: string; settled_at: string | null;
}

/** Catálogo que usa el modo. Por defecto, el persistido del servidor; inyectable en pruebas. */
export interface DraftCatalog {
  cards: readonly CardDef[];
  card(cardId: string): CardDef | undefined;
  player(playerId: string): Player | undefined;
  /** ¿Se puede ofrecer hoy? (publicada). Las retiradas siguen resolviendo, pero no se ofrecen. */
  droppable(cardId: string): boolean;
}

export type DraftLauncher = typeof startDraftMatch;

export interface DraftOptions {
  now?: number;
  catalog?: DraftCatalog;
  launch?: DraftLauncher;
  abandonMatch?: typeof abandonDraftMatch;
  deckCheck?: (runId: string, cardIds: readonly string[]) => DraftDeckCheck;
  seed?: () => number;
}

const ts = (s: string | null | undefined): number | null => (s ? Date.parse(s) : null);
const iso = (n: number) => new Date(n).toISOString();

/* ───────────────────────────── catálogo y pool ───────────────────────────── */

async function catalogFor(sb: SupabaseClient, opts: DraftOptions): Promise<DraftCatalog> {
  if (opts.catalog) return opts.catalog;
  const cat = await serverCatalog(sb);
  return {
    cards: cat.cards,
    card: (id) => cat.registry.card(id),
    player: (id) => cat.registry.player(id),
    droppable: (id) => cat.lifecycleOf(id) === "PUBLISHED",
  };
}

const poolCache = new WeakMap<readonly CardDef[], Map<string, DraftPool>>();
/** Pool de una versión de datos, calculado una vez por catálogo. Determinista: mismo catálogo, mismo pool. */
export function poolFor(catalog: DraftCatalog, dataVersion: string): DraftPool {
  let byVersion = poolCache.get(catalog.cards);
  if (!byVersion) { byVersion = new Map(); poolCache.set(catalog.cards, byVersion); }
  let pool = byVersion.get(dataVersion);
  if (!pool) {
    pool = buildDraftPool({ cards: catalog.cards, player: catalog.player, droppable: catalog.droppable }, dataVersion);
    byVersion.set(dataVersion, pool);
  }
  return pool;
}

/* ───────────────────────────── lectura ───────────────────────────── */

const seedOf = (run: RunRow): number => Number(run.seed);

async function readActiveRun(sb: SupabaseClient, userId: string): Promise<{ run: RunRow | null; error: { code?: string; message: string } | null }> {
  const { data, error } = await sb.from("draft_runs").select(RUN_COLS)
    .eq("user_id", userId).in("status", ACTIVE_STATUSES as unknown as string[])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return { run: (data as RunRow | null) ?? null, error };
}

async function readMatches(sb: SupabaseClient, userId: string, runId: string): Promise<MatchRow[]> {
  const { data, error } = await sb.from("draft_run_matches").select(MATCH_COLS)
    .eq("user_id", userId).eq("run_id", runId).order("stage", { ascending: true }).limit(5);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return (data as MatchRow[] | null) ?? [];
}

const toFact = (m: MatchRow): DraftMatchFact => ({
  stage: m.stage, status: m.status, result: m.result, matchId: m.match_id, scoreYou: m.score_you, scoreRival: m.score_rival,
});

async function snapshotFor(sb: SupabaseClient, userId: string, catalog: DraftCatalog, now: number): Promise<DraftSnapshot> {
  const active = await readActiveRun(sb, userId);
  if (active.error) {
    if (isMissingSchema(active.error)) return unavailable(catalog, now, "MIGRATION_PENDING");
    throw new Error(active.error.message);
  }
  const [matches, hist, last] = await Promise.all([
    active.run ? readMatches(sb, userId, active.run.id) : Promise.resolve([] as MatchRow[]),
    sb.from("draft_runs").select(HISTORY_COLS).eq("user_id", userId).in("status", FINAL_STATUSES as unknown as string[])
      .order("created_at", { ascending: false }).limit(HISTORY_LIMIT),
    // Sin run activa, la última terminada entera (resumen). Con run activa no se lee.
    active.run ? Promise.resolve({ data: null, error: null }) : sb.from("draft_runs").select(RUN_COLS).eq("user_id", userId)
      .in("status", FINAL_STATUSES as unknown as string[]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (hist.error) throw new Error(hist.error.message);
  if (last.error) throw new Error(last.error.message);
  const lastRow = (last.data as RunRow | null) ?? null;
  const lastRun = lastRow ? toRunView(lastRow, (await readMatches(sb, userId, lastRow.id)).map(toFact)) : null;
  const history: DraftHistoryItem[] = ((hist.data as { id: string; status: DraftRunStatus; stage: number; created_at: string; completed_at: string | null }[] | null) ?? [])
    .map((h) => ({ runId: h.id, status: h.status, stage: h.stage, wins: winsOf(h.status, h.stage), createdAt: h.created_at, completedAt: h.completed_at }));
  return buildDraftSnapshot({
    run: active.run ? toRunView(active.run, matches.map(toFact)) : null,
    lastRun, history, resolver: catalog, serverNow: now,
  });
}

function unavailable(catalog: DraftCatalog, now: number, reason: DraftUnavailableReason): DraftSnapshot {
  return buildDraftSnapshot({ run: null, history: [], resolver: catalog, serverNow: now, available: false, unavailableReason: reason });
}

/**
 * `GET` — la foto del jugador. Si la run está EN COMBATE, primero se reconcilia (liquidar una partida ya terminada
 * es idempotente y sale de la partida persistida); en cualquier otro estado, la lectura no escribe.
 */
export async function getDraftGauntlet(sb: SupabaseClient, userId: string, opts: DraftOptions = {}): Promise<DraftResult<DraftSnapshot>> {
  const now = opts.now ?? Date.now();
  const catalog = await catalogFor(sb, opts);
  const active = await readActiveRun(sb, userId);
  if (active.error) {
    if (isMissingSchema(active.error)) return done(unavailable(catalog, now, "MIGRATION_PENDING"));
    return fail(500, "DB", active.error.message);
  }
  if (active.run?.status === "IN_MATCH") await reconcileRun(sb, userId, active.run, null, opts, now).catch((e: unknown) => {
    console.error(`[draft] reconciliación de ${active.run!.id}: ${(e as Error).message}`);
  });
  // F72 · una recompensa fijada y no concedida (fallo a medias) se concede ahora. Idempotente; sin deuda = cero escrituras.
  await settlePendingRewards(sb, userId, now).catch((e: unknown) => console.error(`[draft] recompensas pendientes: ${(e as Error).message}`));
  return done(await snapshotFor(sb, userId, catalog, now));
}

/** Resumen mínimo para el hub de modos: una lectura acotada, sin catálogo. `null` si el modo no está disponible. */
export async function readDraftSummary(sb: SupabaseClient, userId: string): Promise<{ status: DraftRunStatus; pick: number; stage: number } | null> {
  const { run, error } = await readActiveRun(sb, userId);
  if (error) return null;
  if (!run) return { status: "COMPLETED", pick: 0, stage: 0 };
  return { status: run.status, pick: run.state.picks.length, stage: run.stage };
}

/* ───────────────────────────── acciones ───────────────────────────── */

async function stale(sb: SupabaseClient, userId: string, catalog: DraftCatalog, now: number, code: DraftErrorCode = "STALE_VERSION", error = "La run cambió en otra pestaña. Se ha actualizado."): Promise<DraftResult<never>> {
  return fail(409, code, error, { snapshot: await snapshotFor(sb, userId, catalog, now) });
}

/* ───────────────────────────── F72 · entrada ───────────────────────────── */

/** ¿La run tiene entrada sin pagar? (las anteriores a F72 no tienen entrada: se juegan gratis y sin recompensa). */
export const entryPending = (run: { state: DraftRunState }): boolean => !!run.state.entry && !run.state.entry.paidAt;

/**
 * Cobra (o confirma) la entrada de una run. `app_adjust_credits` con clave de la run: repetir no cobra otra vez.
 * Saldo insuficiente con la run intacta (sin elecciones) ⇒ la run se borra: ni run ni asiento.
 */
async function settleEntry(sb: SupabaseClient, userId: string, run: RunRow, catalog: DraftCatalog, now: number): Promise<DraftResult<DraftSnapshot>> {
  const fee = run.state.entry!.fee;
  const c = await chargeEntry(sb, userId, run.id, fee);
  if (!c.ok) {
    if (c.reason === "INSUFFICIENT") {
      if (run.state.picks.length === 0) {
        await sb.from("draft_runs").delete().eq("id", run.id).eq("user_id", userId).eq("status", "DRAFTING").eq("version", run.version);
      }
      return fail(402, "INSUFFICIENT_CREDITS", `Necesitas ${fee} créditos para entrar.`, { snapshot: await snapshotFor(sb, userId, catalog, now) });
    }
    console.error(`[draft] cobro de la entrada de ${run.id}: ${c.message}`);
    return fail(503, "ENTRY_FAILED", "No se pudo cobrar la entrada. Vuelve a intentarlo: nunca se cobra dos veces.");
  }
  const state: DraftRunState = { ...run.state, entry: { ...run.state.entry!, paidAt: iso(now) } };
  // Misma versión a propósito: mientras la entrada está pendiente nadie más escribe la run (elegir está bloqueado), así
  // que marcarla no compite con nada; si la abandonaron entre medias, la condición no toca filas y no pasa nada.
  await sb.from("draft_runs").update({ state, updated_at: iso(now) })
    .eq("id", run.id).eq("user_id", userId).eq("version", run.version).eq("status", "DRAFTING");
  return done(await snapshotFor(sb, userId, catalog, now));
}

/**
 * `start` — ENTRAR. Sin run activa: comprueba saldo, crea la run y cobra la entrada. Con run activa: si su entrada está
 * pendiente, la completa (misma clave); si no, la devuelve tal cual — CONTINUAR nunca cobra.
 */
export async function startDraftRun(sb: SupabaseClient, userId: string, input: { actionId: string }, opts: DraftOptions = {}): Promise<DraftResult<DraftSnapshot>> {
  const now = opts.now ?? Date.now();
  const catalog = await catalogFor(sb, opts);

  const active = await readActiveRun(sb, userId);
  if (active.error) return isMissingSchema(active.error) ? fail(503, "MIGRATION_PENDING", UNAVAILABLE_MESSAGE) : fail(500, "DB", active.error.message);
  if (active.run) {
    if (entryPending(active.run)) return settleEntry(sb, userId, active.run, catalog, now);
    return done(await snapshotFor(sb, userId, catalog, now));
  }
  await settlePendingRewards(sb, userId, now).catch((e: unknown) => console.error(`[draft] recompensas pendientes: ${(e as Error).message}`));

  const credits = await readCredits(sb, userId);
  if (credits === null) return fail(500, "DB", "No se pudo leer tu saldo");
  if (credits < DRAFT_ENTRY_FEE) {
    return fail(402, "INSUFFICIENT_CREDITS", `Necesitas ${DRAFT_ENTRY_FEE} créditos para entrar.`, { snapshot: await snapshotFor(sb, userId, catalog, now) });
  }

  const dataVersion = eligibleDataVersion({ cards: catalog.cards, player: catalog.player, droppable: catalog.droppable });
  const pool = dataVersion !== null ? poolFor(catalog, dataVersion) : null;
  if (!pool || !poolIsSolvable(pool)) return fail(503, "POOL_UNAVAILABLE", "El catálogo no tiene cartas suficientes para un draft ahora mismo.");

  const seed = opts.seed?.() ?? randomInt(0, 2 ** 32);
  let state = createRunState(pool, seed);
  if (!state.offers[0]?.length) return fail(503, "POOL_UNAVAILABLE", "El catálogo no tiene cartas suficientes para un draft ahora mismo.");
  state = recordAction({ ...state, entry: { fee: DRAFT_ENTRY_FEE, economyVersion: DRAFT_ECONOMY_VERSION, paidAt: null } }, { id: input.actionId, kind: "start", version: 1 });

  const runId = randomUUID();
  const ins = await sb.from("draft_runs").insert({
    id: runId, user_id: userId, status: "DRAFTING", stage: 1, version: 1, seed, rules_version: state.rulesVersion,
    data_version: state.dataVersion, state, current_match_id: null, created_at: iso(now), updated_at: iso(now), completed_at: null,
  }).select("id").maybeSingle();
  if (ins.error) {
    // Otra pestaña la creó a la vez: el índice único parcial manda; se devuelve la que ganó.
    // Su creador la cobra; si murió antes, la siguiente entrada la completa con la misma clave.
    if (ins.error.code === "23505") return done(await snapshotFor(sb, userId, catalog, now));
    return isMissingSchema(ins.error) ? fail(503, "MIGRATION_PENDING", UNAVAILABLE_MESSAGE) : fail(500, "DB", ins.error.message);
  }
  const created = await readActiveRun(sb, userId);
  if (created.error) return fail(500, "DB", created.error.message);
  if (!created.run || created.run.id !== runId) return done(await snapshotFor(sb, userId, catalog, now));
  return settleEntry(sb, userId, created.run, catalog, now);
}

/** Replay idempotente: esta acción ya se aplicó sobre la run (reintento de red, doble envío). */
const replayed = (run: RunRow | null, actionId: string, kind: DraftActionKind): boolean => !!run && findAction(run.state, actionId)?.kind === kind;

/** `pick` — UNA elección de la oferta actual persistida. */
export async function pickDraftCard(
  sb: SupabaseClient, userId: string, input: { actionId: string; expectedVersion: number; choiceId: string }, opts: DraftOptions = {},
): Promise<DraftResult<DraftSnapshot>> {
  const now = opts.now ?? Date.now();
  const catalog = await catalogFor(sb, opts);
  const { run, error } = await readActiveRun(sb, userId);
  if (error) return isMissingSchema(error) ? fail(503, "MIGRATION_PENDING", UNAVAILABLE_MESSAGE) : fail(500, "DB", error.message);
  if (!run) return fail(404, "NO_RUN", "No tienes ninguna run en marcha.", { snapshot: await snapshotFor(sb, userId, catalog, now) });
  if (replayed(run, input.actionId, "pick")) return done(await snapshotFor(sb, userId, catalog, now));
  // F72 · sin entrada pagada no se elige (se completa volviendo a ENTRAR, que la cobra una sola vez).
  if (entryPending(run)) return fail(402, "ENTRY_PENDING", "Completa la entrada para empezar el draft.", { snapshot: await snapshotFor(sb, userId, catalog, now) });
  if (run.version !== input.expectedVersion) return stale(sb, userId, catalog, now);
  if (run.status !== "DRAFTING") return stale(sb, userId, catalog, now, "WRONG_STATE", "El draft de esta run ya está completo.");

  const pool = poolFor(catalog, run.data_version);
  const r = applyPick(run.state, pool, seedOf(run), input.choiceId);
  if (!r.ok) {
    return fail(409, "INVALID_PICK", r.code === "NO_OPTIONS" ? "No quedan opciones válidas para el siguiente hueco." : "Esa carta no está en la oferta actual.", {
      reason: r.code, snapshot: await snapshotFor(sb, userId, catalog, now),
    });
  }
  if (r.complete) {
    const check = (opts.deckCheck ?? ((id, cards) => draftDeckCheck(id, cards)))(run.id, r.state.picks);
    if (!check.valid) {
      console.error(`[draft] plantilla ilegal en ${run.id}: ${check.errors.join(", ")}`);
      return fail(409, "DECK_INVALID", "La plantilla no supera la validación del equipo.", { snapshot: await snapshotFor(sb, userId, catalog, now) });
    }
  }

  const version = run.version + 1;
  const state = recordAction(r.state, { id: input.actionId, kind: "pick", version });
  const up = await sb.from("draft_runs").update({ state, version, status: r.complete ? "READY" : "DRAFTING", updated_at: iso(now) })
    .eq("id", run.id).eq("user_id", userId).eq("version", run.version).eq("status", "DRAFTING").select("id");
  if (up.error) return fail(500, "DB", up.error.message);
  if (!((up.data as unknown[] | null) ?? []).length) {
    const again = await readActiveRun(sb, userId);
    if (replayed(again.run, input.actionId, "pick")) return done(await snapshotFor(sb, userId, catalog, now));
    return stale(sb, userId, catalog, now);
  }
  return done(await snapshotFor(sb, userId, catalog, now));
}

export interface StartMatchData { snapshot: DraftSnapshot; matchId: string; view: DuelMatchView | null }

/** `start_match` — lanza el combate de la etapa actual. Repetirlo devuelve el combate ya activo. */
export async function startDraftStage(
  sb: SupabaseClient, userId: string, input: { actionId: string; expectedVersion: number }, opts: DraftOptions = {},
): Promise<DraftResult<StartMatchData>> {
  const now = opts.now ?? Date.now();
  const catalog = await catalogFor(sb, opts);
  let { run, error } = await readActiveRun(sb, userId);
  if (error) return isMissingSchema(error) ? fail(503, "MIGRATION_PENDING", UNAVAILABLE_MESSAGE) : fail(500, "DB", error.message);
  if (!run) return fail(404, "NO_RUN", "No tienes ninguna run en marcha.", { snapshot: await snapshotFor(sb, userId, catalog, now) });

  if (run.status === "IN_MATCH") {
    await reconcileRun(sb, userId, run, null, opts, now);
    ({ run } = await readActiveRun(sb, userId));
    if (run?.status === "IN_MATCH" && run.current_match_id) {
      return done({ snapshot: await snapshotFor(sb, userId, catalog, now), matchId: run.current_match_id, view: null });
    }
    if (!run) return stale(sb, userId, catalog, now, "WRONG_STATE", "Esta run ya ha terminado.");
    // Tras reconciliar, la versión cambió: el cliente debe ver el resultado antes de lanzar otra etapa.
    return stale(sb, userId, catalog, now);
  }
  if (run.version !== input.expectedVersion) return stale(sb, userId, catalog, now);
  if (run.status !== "READY") return stale(sb, userId, catalog, now, "WRONG_STATE", "Completa el draft antes de jugar.");

  const stage = run.stage;
  const rivals = run.state.rivals ?? rivalsFor(poolFor(catalog, run.data_version), seedOf(run));
  const rival = rivals[stage - 1];
  if (!rival) return fail(503, "POOL_UNAVAILABLE", "Este rival no está disponible ahora mismo.");

  const matchId = randomUUID();
  const version = run.version + 1;
  const claimed = await sb.from("draft_runs").update({
    status: "IN_MATCH", current_match_id: matchId, version, updated_at: iso(now),
    state: recordAction(rivals === run.state.rivals ? run.state : { ...run.state, rivals }, { id: input.actionId, kind: "start_match", version }),
  }).eq("id", run.id).eq("user_id", userId).eq("version", run.version).eq("status", "READY").select("id");
  if (claimed.error) return fail(500, "DB", claimed.error.message);
  if (!((claimed.data as unknown[] | null) ?? []).length) {
    const again = await readActiveRun(sb, userId);
    if (again.run?.status === "IN_MATCH" && again.run.current_match_id) {
      return done({ snapshot: await snapshotFor(sb, userId, catalog, now), matchId: again.run.current_match_id, view: null });
    }
    return stale(sb, userId, catalog, now);
  }

  const launch = opts.launch ?? startDraftMatch;
  const res = await launch(sb, userId, {
    matchId, runId: run.id, cardIds: run.state.picks, level: STAGE_DIFFICULTY[stage - 1],
    rival: { cardIds: rival.cardIds, name: rival.name, label: `draft-${run.id.slice(0, 8)}-s${stage}` },
  }).catch((e: unknown) => ({ ok: false, status: 500, error: (e as Error).message }) as ServiceResult<{ view: DuelMatchView }>);

  if (!res.ok || !res.data) {
    await sb.from("draft_runs").update({ status: "READY", current_match_id: null, version: version + 1, updated_at: iso(now) })
      .eq("id", run.id).eq("user_id", userId).eq("status", "IN_MATCH").eq("current_match_id", matchId);
    console.error(`[draft] no se pudo lanzar la etapa ${stage} de ${run.id}: ${res.error}`);
    if (res.status === 409) return fail(409, "DECK_INVALID", "La plantilla no supera la validación del equipo.", { snapshot: await snapshotFor(sb, userId, catalog, now) });
    return fail(500, "MATCH_FAILED", res.error ?? "No se pudo empezar el combate");
  }

  const link = await sb.from("draft_run_matches").insert({
    run_id: run.id, user_id: userId, stage, match_id: matchId, difficulty: STAGE_DIFFICULTY[stage - 1],
    status: "STARTED", result: null, score_you: null, score_rival: null, created_at: iso(now), settled_at: null,
  });
  // Si el enlace falla, la reconciliación lo recrea desde `current_match_id` (la partida existe y es de la run).
  if (link.error) console.error(`[draft] enlace de la etapa ${stage} de ${run.id}: ${link.error.message}`);

  return done({ snapshot: await snapshotFor(sb, userId, catalog, now), matchId, view: res.data.view });
}

/* ───────────────────────────── liquidar ───────────────────────────── */

export interface DraftMatchFacts {
  status: string;
  result: { winner: "A" | "B" | null; isDraw: boolean; scoreA?: number; scoreB?: number } | null;
}

export interface DraftSettleOutcome {
  settled: boolean;
  reason?: "MIGRATION_PENDING" | "NO_RUN" | "IN_PROGRESS" | "ALREADY_SETTLED" | "RELAUNCHABLE" | "VANISHED";
  outcome?: StageOutcome;
  runStatus?: DraftRunStatus;
}

/** F72 · estado con la recompensa FIJADA al cerrar (solo runs con entrada; las anteriores a F72 no pagan). */
function withReward(state: DraftRunState, final: { status: DraftRunStatus; stage: number }, now: number): DraftRunState {
  if (!state.entry || state.reward) return state;
  return { ...state, reward: rewardStateFor(winsOf(final.status, final.stage), now) };
}

async function closeRun(sb: SupabaseClient, userId: string, run: RunRow, matchId: string, next: { status: DraftRunStatus; stage: number }, now: number) {
  const final = (FINAL_STATUSES as readonly string[]).includes(next.status);
  return sb.from("draft_runs").update({
    status: next.status, stage: next.stage, version: run.version + 1, current_match_id: null,
    completed_at: final ? iso(now) : null, updated_at: iso(now),
    ...(final ? { state: withReward(run.state, next, now) } : {}),
  }).eq("id", run.id).eq("user_id", userId).eq("status", "IN_MATCH").eq("current_match_id", matchId).select("id");
}

/* ───────────────────────────── F72 · recompensas ───────────────────────────── */

/**
 * Concede la recompensa fijada de una run TERMINADA y la marca. Idempotente por las claves del libro mayor: repetirla
 * (recarga, otra pestaña, reintento tras un fallo) no paga dos veces. Si falla, queda pendiente y se reintenta.
 */
async function settleRunReward(sb: SupabaseClient, userId: string, runId: string, now: number): Promise<void> {
  const { data, error } = await sb.from("draft_runs").select(RUN_COLS).eq("id", runId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as RunRow | null;
  const reward = row?.state.reward;
  if (!row || !reward || reward.grantedAt || !(FINAL_STATUSES as readonly string[]).includes(row.status)) return;
  const out = await grantRunReward(sb, userId, row.id, reward);
  const state: DraftRunState = { ...row.state, reward: { ...reward, jackpot: reward.jackpotWeek ? out.jackpot : false, grantedAt: iso(now) } };
  // Una run terminada no cambia de versión: solo se anota que su recompensa ya está concedida.
  await sb.from("draft_runs").update({ state, updated_at: iso(now) }).eq("id", row.id).eq("user_id", userId).eq("status", row.status);
}

const settleQuietly = (sb: SupabaseClient, userId: string, runId: string, now: number) =>
  settleRunReward(sb, userId, runId, now).catch((e: unknown) => console.error(`[draft] recompensa de ${runId} pendiente: ${(e as Error).message}`));

/** Concede lo que las últimas runs terminadas deban (pocas filas; sin deuda no escribe nada). */
async function settlePendingRewards(sb: SupabaseClient, userId: string, now: number): Promise<void> {
  const { data, error } = await sb.from("draft_runs").select(RUN_COLS).eq("user_id", userId)
    .in("status", FINAL_STATUSES as unknown as string[]).order("created_at", { ascending: false }).limit(HISTORY_LIMIT);
  if (error) { if (isMissingSchema(error)) return; throw new Error(error.message); }
  for (const r of (data as RunRow[] | null) ?? []) {
    if (r.state?.reward && !r.state.reward.grantedAt) await settleRunReward(sb, userId, r.id, now);
  }
}

/**
 * Cierra la etapa en curso de una run IN_MATCH con los HECHOS de su partida (o los lee). Idempotente y segura entre
 * pestañas: el combate se reclama `STARTED → SETTLED` y la run `IN_MATCH(match) → siguiente` condicionalmente.
 */
async function reconcileRun(sb: SupabaseClient, userId: string, run: RunRow, known: DraftMatchFacts | null, opts: DraftOptions, now: number): Promise<DraftSettleOutcome> {
  const matchId = run.current_match_id;
  if (run.status !== "IN_MATCH") return { settled: false, reason: "ALREADY_SETTLED" };
  const stage = run.stage;
  const stageRow = (await readMatches(sb, userId, run.id)).find((m) => m.stage === stage) ?? null;

  if (!matchId) {
    // Estado imposible por CHECK en BD; por si acaso, se devuelve a READY.
    await sb.from("draft_runs").update({ status: "READY", version: run.version + 1, updated_at: iso(now) }).eq("id", run.id).eq("user_id", userId).eq("status", "IN_MATCH");
    return { settled: false, reason: "RELAUNCHABLE" };
  }

  let facts = known;
  if (!facts) {
    const m = await sb.from("duel_matches").select("id, status, mode, state").eq("id", matchId).eq("user_id", userId).maybeSingle();
    if (m.error) throw new Error(m.error.message);
    const row = m.data as { status: string; mode?: string | null; state?: { status?: string; result?: { winner: "A" | "B" | null; isDraw: boolean; scoreA: number; scoreB: number } | null } } | null;
    if (!row || row.mode !== DRAFT_GAUNTLET_MODE) {
      if (now - (ts(run.updated_at) ?? now) < LAUNCH_TTL_MS) return { settled: false, reason: "IN_PROGRESS" };
      if (!stageRow) {
        // La partida nunca llegó a crearse: la etapa se puede volver a lanzar.
        await sb.from("draft_runs").update({ status: "READY", current_match_id: null, version: run.version + 1, updated_at: iso(now) })
          .eq("id", run.id).eq("user_id", userId).eq("status", "IN_MATCH").eq("current_match_id", matchId);
        return { settled: false, reason: "RELAUNCHABLE" };
      }
      // La partida desapareció (no la borra nadie salvo abandonar la run): la run no puede seguir.
      await sb.from("draft_run_matches").update({ status: "ABANDONED" }).eq("run_id", run.id).eq("stage", stage).eq("status", "STARTED");
      const vanished = await closeRun(sb, userId, run, matchId, { status: "FAILED", stage }, now);
      if (((vanished.data as unknown[] | null) ?? []).length) await settleQuietly(sb, userId, run.id, now);
      return { settled: false, reason: "VANISHED", runStatus: "FAILED" };
    }
    facts = { status: row.state?.status ?? row.status, result: row.state?.result ?? null };
  }
  if (facts.status === "IN_PROGRESS" || facts.status === "WAITING") return { settled: false, reason: "IN_PROGRESS" };

  const outcome: StageOutcome = outcomeForHuman(facts.result) ?? "DRAW";
  const patch = {
    status: "SETTLED", result: outcome, settled_at: iso(now),
    score_you: facts.result?.scoreA ?? null, score_rival: facts.result?.scoreB ?? null,
  };

  if (!stageRow) {
    const ins = await sb.from("draft_run_matches").insert({
      run_id: run.id, user_id: userId, stage, match_id: matchId, difficulty: STAGE_DIFFICULTY[stage - 1], created_at: iso(now), ...patch,
    });
    if (ins.error && ins.error.code !== "23505") throw new Error(ins.error.message);
  } else if (stageRow.status === "STARTED") {
    const claim = await sb.from("draft_run_matches").update(patch)
      .eq("run_id", run.id).eq("stage", stage).eq("status", "STARTED").select("stage");
    if (claim.error) throw new Error(claim.error.message);
  }
  // El resultado que manda es el ya registrado (si otra liquidación llegó antes, el mismo).
  const registered = stageRow?.status === "SETTLED" && stageRow.result ? stageRow.result : outcome;
  const next = settleTransition({ status: "IN_MATCH", stage }, registered);
  const closed = await closeRun(sb, userId, run, matchId, next, now);
  if (closed.error) throw new Error(closed.error.message);
  if (!((closed.data as unknown[] | null) ?? []).length) return { settled: false, reason: "ALREADY_SETTLED", outcome: registered };
  if ((FINAL_STATUSES as readonly string[]).includes(next.status)) await settleQuietly(sb, userId, run.id, now);
  return { settled: true, outcome: registered, runStatus: next.status };
}

/**
 * Liquida la run de UNA partida terminada. La llama `services/duels.playTurn` al cerrar el combate (con los hechos
 * que ya tiene) y la lectura (sin ellos). Idempotente: la segunda llamada es un no-op.
 */
export async function settleDraftMatch(sb: SupabaseClient, userId: string, matchId: string, known: DraftMatchFacts | null = null, opts: DraftOptions = {}): Promise<DraftSettleOutcome> {
  const { data, error } = await sb.from("draft_runs").select(RUN_COLS)
    .eq("user_id", userId).eq("current_match_id", matchId).eq("status", "IN_MATCH").limit(1).maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return { settled: false, reason: "MIGRATION_PENDING" };
    throw new Error(error.message);
  }
  if (!data) return { settled: false, reason: "NO_RUN" };
  return reconcileRun(sb, userId, data as RunRow, known, opts, opts.now ?? Date.now());
}

/* ───────────────────────────── abandonar ───────────────────────────── */

/**
 * `abandon` — termina la run activa como ABANDONED (con confirmación en la interfaz y `confirm: true` en la ruta).
 * Si su combate ya terminó, primero se liquida: abandonar nunca se come un resultado (y la versión cambia → 409).
 */
export async function abandonDraftRun(
  sb: SupabaseClient, userId: string, input: { actionId: string; expectedVersion: number }, opts: DraftOptions = {},
): Promise<DraftResult<DraftSnapshot>> {
  const now = opts.now ?? Date.now();
  const catalog = await catalogFor(sb, opts);
  let { run, error } = await readActiveRun(sb, userId);
  if (error) return isMissingSchema(error) ? fail(503, "MIGRATION_PENDING", UNAVAILABLE_MESSAGE) : fail(500, "DB", error.message);
  if (!run) {
    const last = await sb.from("draft_runs").select(RUN_COLS).eq("user_id", userId).eq("status", "ABANDONED")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (replayed((last.data as RunRow | null) ?? null, input.actionId, "abandon")) return done(await snapshotFor(sb, userId, catalog, now));
    return fail(404, "NO_RUN", "No tienes ninguna run en marcha.", { snapshot: await snapshotFor(sb, userId, catalog, now) });
  }
  if (run.status === "IN_MATCH") {
    await reconcileRun(sb, userId, run, null, opts, now);
    ({ run } = await readActiveRun(sb, userId));
    if (!run) return stale(sb, userId, catalog, now, "WRONG_STATE", "El combate ya había terminado y la run se cerró.");
  }
  if (run.version !== input.expectedVersion) return stale(sb, userId, catalog, now);

  const version = run.version + 1;
  // F72 · abandonar paga lo mismo que perder en esta etapa (victorias ya conseguidas) y nunca devuelve la entrada.
  const up = await sb.from("draft_runs").update({
    status: "ABANDONED", current_match_id: null, completed_at: iso(now), updated_at: iso(now), version,
    state: recordAction(entryPending(run) ? run.state : withReward(run.state, { status: "ABANDONED", stage: run.stage }, now), { id: input.actionId, kind: "abandon", version }),
  }).eq("id", run.id).eq("user_id", userId).eq("version", run.version).in("status", ACTIVE_STATUSES as unknown as string[]).select("id");
  if (up.error) return fail(500, "DB", up.error.message);
  if (!((up.data as unknown[] | null) ?? []).length) return stale(sb, userId, catalog, now);

  if (run.status === "IN_MATCH" && run.current_match_id) {
    const ab = await (opts.abandonMatch ?? abandonDraftMatch)(sb, userId, run.current_match_id).catch((e: unknown) => ({ ok: false, status: 500, error: (e as Error).message }));
    if (!ab.ok) console.error(`[draft] no se pudo borrar el combate de ${run.id}: ${ab.error}`);
    await sb.from("draft_run_matches").update({ status: "ABANDONED" }).eq("run_id", run.id).eq("stage", run.stage).eq("status", "STARTED");
  }
  await settleQuietly(sb, userId, run.id, now);
  return done(await snapshotFor(sb, userId, catalog, now));
}

export type { DraftRunState };
