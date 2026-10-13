/**
 * ROAD TO CHAMPIONS — SERVICIO CON AUTORIDAD DE SERVIDOR (Fase 35, SOLO SERVIDOR).
 *
 *   NODO DE CAMPAÑA → PREPARAR PARTIDA → MOTOR PvE CANÓNICO → RESULTADO AUTORITATIVO → PROGRESIÓN DE CAMPAÑA
 *
 * No hay motor de campaña. Este fichero decide QUÉ partida se lanza (rival real y dificultad canónica del nodo)
 * y, cuando el motor ya ha dicho quién ganó, qué significa eso para el mapa. La partida la crea y la juega
 * `services/duels` con las mismas reglas, bots, turnos y pagos que una partida rápida.
 *
 * FRONTERAS
 *   1. El cliente solo manda `action`, `nodeId` y, opcionalmente, qué equipo SUYO usa. Nunca dificultad, rival,
 *      resultado, recompensa ni usuario: todo eso sale de la definición versionada y del token.
 *   2. Lanzar exige: nodo existente, desbloqueado según el progreso del SERVIDOR, rival con mazo legal, ninguna
 *      partida PvE en curso y un único intento abierto (índice único de 0051).
 *   3. Liquidar es idempotente: transición condicional STARTED → SETTLED por intento; `match_id` único; primera
 *      victoria única por nodo (índice) y pago con clave única del libro mayor.
 *   4. Sin 0051 aplicada: lectura `available: false` («TODAVÍA NO DISPONIBLE») y lanzar = 503 MIGRATION_PENDING.
 *   5. Campaña ≠ ranked: nunca toca rating, cola ni liquidación competitiva.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog } from "@/server/catalog";
import { ROAD_TO_CHAMPIONS } from "@/data/roadToChampions";
import { teamIdentityById } from "@/data/teamIdentities";
import {
  validateCampaign, findNode, nodeCardTier, allNodes, buildOpponentPlan, canStartNode, applyOutcome, outcomeForHuman,
  resolveStatuses, summarize, buildCampaignSnapshot, botDifficultyOf, firstClearRef, CAMPAIGN_REWARD_REASON,
  type BotDifficulty, type CampaignAttemptView, type CampaignCatalog, type CampaignDefinition, type CampaignOutcome,
  type CampaignSnapshot, type CampaignUnavailableReason, type NodeProgress, type OpponentPlan,
} from "@/domain/campaign";
import { startCampaignMatch, listDecks, abandonMatch, type ServiceResult } from "./duels";
import { readActive, isMissingSchema } from "./deckTeams";
import { award } from "./rewards";
import type { DuelMatchView } from "@/lib/duel/types";

export type CampaignErrorCode =
  | "MIGRATION_PENDING" | "INVALID_DEFINITION" | "UNKNOWN_NODE" | "LOCKED" | "ACTIVE_MATCH" | "ACTIVE_ATTEMPT"
  | "DECK_NOT_READY" | "RIVAL_UNAVAILABLE" | "NO_ATTEMPT" | "DB";

export interface CampaignResult<T> {
  ok: boolean;
  status: number;
  error?: string;
  code?: CampaignErrorCode;
  data?: T;
  /** Datos no sensibles que ayudan a la interfaz (p. ej. el nodo en marcha para retomarlo). */
  extra?: Record<string, unknown>;
}

const done = <T>(data: T): CampaignResult<T> => ({ ok: true, status: 200, data });
const fail = (status: number, code: CampaignErrorCode, error: string, extra?: Record<string, unknown>): CampaignResult<never> =>
  ({ ok: false, status, code, error, ...(extra ? { extra } : {}) });

export const UNAVAILABLE_MESSAGE = "ROAD TO CHAMPIONS TODAVÍA NO DISPONIBLE";

/** Una reserva sin partida enlazada más vieja que esto se da por abandonada (la creación falló a medias). */
export const RESERVATION_TTL_MS = 2 * 60_000;
/** Cotas de lectura: nunca una consulta sin límite, nunca N+1. */
const PROGRESS_LIMIT = 100;
const ATTEMPTS_RECENT = 5;
const RECONCILE_LIMIT = 5;

const PROGRESS_COLS = "node_id, campaign_version, status, best_result, attempts, wins, first_cleared_at, first_clear_match_id, updated_at";
const ATTEMPT_COLS = "id, node_id, match_id, status, result, first_clear, reward_granted, created_at, settled_at";

interface ProgressRow {
  node_id: string; campaign_version: string; status: "ATTEMPTED" | "COMPLETED"; best_result: CampaignOutcome | null;
  attempts: number; wins: number; first_cleared_at: string | null; first_clear_match_id: string | null; updated_at: string;
}
interface AttemptRow {
  id: string; node_id: string; match_id: string | null; status: "STARTED" | "SETTLED" | "ABANDONED"; result: CampaignOutcome | null;
  first_clear: boolean; reward_granted: boolean; created_at: string; settled_at: string | null;
}

export interface CampaignOptions {
  def?: CampaignDefinition;
  now?: number;
  /** Catálogo inyectado (pruebas). Por defecto, el catálogo persistido del servidor. */
  catalog?: CampaignCatalog;
}

const ts = (s: string | null): number | null => (s ? Date.parse(s) : null);

function toProgress(r: ProgressRow): NodeProgress {
  return {
    nodeId: r.node_id, version: r.campaign_version, status: r.status, bestResult: r.best_result,
    attempts: r.attempts, wins: r.wins, firstClearedAt: ts(r.first_cleared_at), firstClearMatchId: r.first_clear_match_id,
    updatedAt: ts(r.updated_at) ?? 0,
  };
}

function toAttemptView(r: AttemptRow): CampaignAttemptView {
  return { nodeId: r.node_id, matchId: r.match_id, status: r.status, result: r.result, firstClear: r.first_clear, settledAt: ts(r.settled_at) };
}

/* ───────────────────────────── definición y rivales (cacheables) ───────────────────────────── */

const validity = new WeakMap<CampaignDefinition, boolean>();
function isValid(def: CampaignDefinition): boolean {
  let v = validity.get(def);
  if (v === undefined) {
    const r = validateCampaign(def);
    if (!r.ok) console.error("[campaign] definición inválida", def.version, r.issues.slice(0, 5));
    v = r.ok;
    validity.set(def, v);
  }
  return v;
}

const planCache = new WeakMap<object, Map<CampaignDefinition, Map<string, OpponentPlan>>>();
/** Mazo de cada rival, calculado UNA vez por (catálogo, definición). Determinista: la misma entrada, el mismo mazo. */
export function opponentPlans(def: CampaignDefinition, catalog: CampaignCatalog): Map<string, OpponentPlan> {
  let byDef = planCache.get(catalog);
  if (!byDef) { byDef = new Map(); planCache.set(catalog, byDef); }
  let plans = byDef.get(def);
  if (!plans) {
    plans = new Map();
    for (const n of allNodes(def)) plans.set(n.id, buildOpponentPlan(catalog, n.opponent.teamId, nodeCardTier(def, n.id)!));
    byDef.set(def, plans);
  }
  return plans;
}

async function catalogFor(sb: SupabaseClient, opts: CampaignOptions): Promise<CampaignCatalog> {
  return opts.catalog ?? (await serverCatalog(sb)).registry;
}

/* ───────────────────────────── lectura ───────────────────────────── */

function unavailable(def: CampaignDefinition, plans: Map<string, OpponentPlan>, reason: CampaignUnavailableReason, now: number): CampaignSnapshot {
  return buildCampaignSnapshot({ def, opponents: plans, progress: [], available: false, unavailableReason: reason, serverNow: now });
}

/** Definición pública (sin sesión): el mapa como vista previa. Cacheable; no lee progreso. */
export async function getCampaignDefinition(sb: SupabaseClient, opts: CampaignOptions = {}): Promise<CampaignResult<CampaignSnapshot>> {
  const def = opts.def ?? ROAD_TO_CHAMPIONS;
  const now = opts.now ?? Date.now();
  const plans = opponentPlans(def, await catalogFor(sb, opts));
  if (!isValid(def)) return done(unavailable(def, plans, "INVALID_DEFINITION", now));
  return done(buildCampaignSnapshot({ def, opponents: plans, progress: [], available: true, unavailableReason: null, serverNow: now }));
}

/**
 * La foto del mapa de UN usuario. SOLO LECTURA: no liquida, no reserva, no paga. La reconciliación es
 * explícita (`action: "sync"`) o va dentro de lanzar un nodo.
 */
export async function getCampaign(sb: SupabaseClient, userId: string, opts: CampaignOptions = {}): Promise<CampaignResult<CampaignSnapshot>> {
  const def = opts.def ?? ROAD_TO_CHAMPIONS;
  const now = opts.now ?? Date.now();
  const plans = opponentPlans(def, await catalogFor(sb, opts));
  if (!isValid(def)) return done(unavailable(def, plans, "INVALID_DEFINITION", now));

  const [prog, att] = await Promise.all([
    sb.from("campaign_progress").select(PROGRESS_COLS).eq("user_id", userId).eq("campaign_id", def.campaignId).limit(PROGRESS_LIMIT),
    sb.from("campaign_attempts").select(ATTEMPT_COLS).eq("user_id", userId).eq("campaign_id", def.campaignId)
      .order("created_at", { ascending: false }).limit(ATTEMPTS_RECENT),
  ]);
  const err = prog.error ?? att.error;
  if (err) {
    if (isMissingSchema(err)) return done(unavailable(def, plans, "MIGRATION_PENDING", now));
    return fail(500, "DB", err.message);
  }
  const attempts = (att.data as AttemptRow[] | null) ?? [];
  const open = attempts.find((a) => a.status === "STARTED") ?? null;
  const last = attempts.find((a) => a.status === "SETTLED") ?? null;
  return done(buildCampaignSnapshot({
    def, opponents: plans, progress: ((prog.data as ProgressRow[] | null) ?? []).map(toProgress),
    available: true, unavailableReason: null, activeAttempt: open ? toAttemptView(open) : null, lastAttempt: last ? toAttemptView(last) : null,
    serverNow: now,
  }));
}

export interface CampaignSummaryLite {
  completed: number;
  total: number;
  complete: boolean;
  next: { nodeId: string; name: string; team: string; chapterOrder: number } | null;
}

/**
 * Resumen mínimo para el vestíbulo (NextUp) y el perfil propio: UNA consulta acotada, sin catálogo.
 * `null` si la campaña no está disponible (0051 sin aplicar, error): quien llama no propone nada.
 */
export async function readCampaignSummary(sb: SupabaseClient, userId: string, opts: CampaignOptions = {}): Promise<CampaignSummaryLite | null> {
  const def = opts.def ?? ROAD_TO_CHAMPIONS;
  if (!isValid(def)) return null;
  const { data, error } = await sb.from("campaign_progress").select(PROGRESS_COLS)
    .eq("user_id", userId).eq("campaign_id", def.campaignId).limit(PROGRESS_LIMIT);
  if (error) return null;
  const statuses = resolveStatuses(def, ((data as ProgressRow[] | null) ?? []).map(toProgress));
  const s = summarize(def, statuses);
  const next = s.nextNodeId ? findNode(def, s.nextNodeId) : null;
  return {
    completed: s.completed, total: s.total, complete: s.complete,
    next: next ? { nodeId: next.node.id, name: next.node.name, team: teamIdentityById(next.node.opponent.teamId)?.displayName ?? next.node.opponent.teamId, chapterOrder: next.chapterOrder } : null,
  };
}

/* ───────────────────────────── lanzar un nodo ───────────────────────────── */

export type CampaignLauncher = (
  sb: SupabaseClient, userId: string, deckId: string, level: BotDifficulty,
  rival: { cardIds: readonly string[]; name: string; label: string },
) => Promise<ServiceResult<{ view: DuelMatchView }>>;

export interface StartOptions extends CampaignOptions {
  /** Creador de partida inyectable (pruebas). Por defecto, el PvE canónico de `services/duels`. */
  launch?: CampaignLauncher;
}

async function defaultDeckId(sb: SupabaseClient, userId: string): Promise<string | null> {
  const active = await readActive(sb, userId).catch(() => ({ deckId: null as string | null }));
  if (active.deckId) return active.deckId;
  const decks = await listDecks(sb, userId).catch(() => null);
  return decks?.ok ? decks.data?.decks.find((d) => d.valid)?.id ?? null : null;
}

export async function startCampaignNode(
  sb: SupabaseClient, userId: string, input: { nodeId: string; deckId?: string | null }, opts: StartOptions = {},
): Promise<CampaignResult<{ view: DuelMatchView; nodeId: string; replay: boolean }>> {
  const def = opts.def ?? ROAD_TO_CHAMPIONS;
  const now = opts.now ?? Date.now();
  if (!isValid(def)) return fail(503, "INVALID_DEFINITION", "Road to Champions no está disponible ahora mismo.");
  const found = findNode(def, input.nodeId);
  if (!found) return fail(404, "UNKNOWN_NODE", "Ese nodo no existe.");

  // Antes de nada, cerrar lo que quedara a medias (partida terminada sin liquidar, reserva huérfana).
  const rec = await reconcileCampaign(sb, userId, { def, now });
  if (rec.missing) return fail(503, "MIGRATION_PENDING", UNAVAILABLE_MESSAGE);

  const prog = await sb.from("campaign_progress").select(PROGRESS_COLS)
    .eq("user_id", userId).eq("campaign_id", def.campaignId).limit(PROGRESS_LIMIT);
  if (prog.error) return isMissingSchema(prog.error) ? fail(503, "MIGRATION_PENDING", UNAVAILABLE_MESSAGE) : fail(500, "DB", prog.error.message);
  const progress = ((prog.data as ProgressRow[] | null) ?? []).map(toProgress);
  const check = canStartNode(def, progress, found.node.id);
  if (!check.ok) return fail(409, "LOCKED", "Completa el nodo anterior para desbloquear este.");

  const plan = opponentPlans(def, await catalogFor(sb, opts)).get(found.node.id);
  if (!plan || !plan.ok) return fail(503, "RIVAL_UNAVAILABLE", "Este rival no está disponible ahora mismo.");

  // Una partida PvE en curso manda: se retoma o se abandona antes de abrir otra.
  const active = await sb.from("duel_matches").select("id").eq("user_id", userId).eq("mode", "PVE").eq("status", "IN_PROGRESS").limit(1).maybeSingle();
  if (active.error) return fail(500, "DB", active.error.message);
  if (active.data) return fail(409, "ACTIVE_MATCH", "Tienes una partida en curso. Termínala o abandónala antes de jugar este nodo.", { matchId: (active.data as { id: string }).id });

  const deckId = input.deckId ?? await defaultDeckId(sb, userId);
  if (!deckId) return fail(409, "DECK_NOT_READY", "Necesitas un equipo válido para jugar.");

  // Reserva: el índice único parcial de 0051 impide dos intentos abiertos (dos pestañas, doble clic).
  const reserve = await sb.from("campaign_attempts").insert({
    user_id: userId, campaign_id: def.campaignId, campaign_version: def.version, node_id: found.node.id, status: "STARTED",
  }).select("id").maybeSingle();
  if (reserve.error) {
    if (reserve.error.code === "23505") return fail(409, "ACTIVE_ATTEMPT", "Ya tienes un nodo en marcha. Retómalo o abandónalo.");
    return isMissingSchema(reserve.error) ? fail(503, "MIGRATION_PENDING", UNAVAILABLE_MESSAGE) : fail(500, "DB", reserve.error.message);
  }
  const attemptId = (reserve.data as { id: string }).id;

  const launch = opts.launch ?? startCampaignMatch;
  const res = await launch(sb, userId, deckId, botDifficultyOf(found.node.difficulty), {
    cardIds: plan.cards.map((c) => c.cardId), name: plan.teamName, label: `rtc-${found.node.id}`,
  }).catch((e: unknown) => ({ ok: false, status: 500, error: (e as Error).message }) as ServiceResult<{ view: DuelMatchView }>);

  if (!res.ok || !res.data) {
    await sb.from("campaign_attempts").delete().eq("id", attemptId).eq("user_id", userId).eq("status", "STARTED");
    if (res.status === 404 || res.status === 409) return fail(409, "DECK_NOT_READY", res.error ?? "Ese equipo no puede jugar.");
    return fail(res.status >= 500 ? 500 : res.status, "DB", res.error ?? "No se pudo empezar la partida");
  }

  const view = res.data.view;
  const link = await sb.from("campaign_attempts").update({ match_id: view.matchId }).eq("id", attemptId).eq("user_id", userId);
  if (link.error) console.error(`[campaign] no se pudo enlazar la partida ${view.matchId}: ${link.error.message}`);

  const replay = progress.some((p) => p.nodeId === found.node.id && p.status === "COMPLETED");
  return done({ view: { ...view, rivalLabel: plan.teamName }, nodeId: found.node.id, replay });
}

/* ───────────────────────────── liquidar ───────────────────────────── */

export interface MatchFacts { status: string; result: { winner: "A" | "B" | null; isDraw: boolean } | null }

export interface SettleOutcome {
  settled: boolean;
  reason?: "MIGRATION_PENDING" | "NO_ATTEMPT" | "IN_PROGRESS" | "ALREADY_SETTLED" | "ABANDONED";
  outcome?: CampaignOutcome;
  firstClear?: boolean;
  nodeId?: string;
}

async function markAbandoned(sb: SupabaseClient, userId: string, attemptId: string) {
  await sb.from("campaign_attempts").update({ status: "ABANDONED" }).eq("id", attemptId).eq("user_id", userId).eq("status", "STARTED");
}

async function grantFirstClear(sb: SupabaseClient, userId: string, def: CampaignDefinition, att: Pick<AttemptRow, "id" | "node_id">): Promise<boolean> {
  const found = findNode(def, att.node_id);
  if (!found) return false;
  const credits = found.node.rewards.firstClear.credits;
  try {
    if (credits > 0) {
      await award(sb, { userId, ref: firstClearRef(def.campaignId, att.node_id), reason: CAMPAIGN_REWARD_REASON, reward: { credits } });
    }
    await sb.from("campaign_attempts").update({ reward_granted: true }).eq("id", att.id).eq("user_id", userId).eq("first_clear", true);
    return true;
  } catch (e) {
    // Reintentable: `reconcileCampaign` vuelve a pedirlo; la clave del libro mayor impide pagar dos veces.
    console.error(`[campaign] primera victoria ${att.node_id} pendiente de pago: ${(e as Error).message}`);
    return false;
  }
}

async function settleAttempt(
  sb: SupabaseClient, userId: string, att: AttemptRow, known: MatchFacts | null, def: CampaignDefinition, now: number,
): Promise<SettleOutcome> {
  let facts = known;
  if (!facts) {
    if (!att.match_id) return { settled: false, reason: "IN_PROGRESS" };
    const m = await sb.from("duel_matches").select("id, status, mode, state").eq("id", att.match_id).eq("user_id", userId).maybeSingle();
    if (m.error) throw new Error(m.error.message);
    const row = m.data as { status: string; mode?: string | null; state?: { result?: { winner: "A" | "B" | null; isDraw: boolean } | null } } | null;
    if (!row || (row.mode && row.mode !== "PVE")) { await markAbandoned(sb, userId, att.id); return { settled: false, reason: "ABANDONED", nodeId: att.node_id }; }
    facts = { status: row.status, result: row.state?.result ? { winner: row.state.result.winner, isDraw: row.state.result.isDraw } : null };
  }
  if (facts.status === "IN_PROGRESS" || facts.status === "WAITING") return { settled: false, reason: "IN_PROGRESS" };
  if (!facts.result) { await markAbandoned(sb, userId, att.id); return { settled: false, reason: "ABANDONED", nodeId: att.node_id }; }

  const outcome = outcomeForHuman(facts.result);
  const found = findNode(def, att.node_id);

  // Progreso previo ANTES de reclamar: con un único intento abierto por usuario, nadie lo cambia en medio.
  let prev: NodeProgress | null = null;
  if (found) {
    const p = await sb.from("campaign_progress").select(PROGRESS_COLS)
      .eq("user_id", userId).eq("campaign_id", def.campaignId).eq("node_id", att.node_id).maybeSingle();
    if (p.error) throw new Error(p.error.message);
    prev = p.data ? toProgress(p.data as ProgressRow) : null;
  }
  const applied = found ? applyOutcome(prev, { nodeId: att.node_id, version: def.version, outcome, matchId: att.match_id ?? "", at: now }) : null;
  const settledAt = new Date(now).toISOString();

  // Transición condicional: solo UNA liquidación gana (la otra ve 0 filas).
  let claim = await sb.from("campaign_attempts")
    .update({ status: "SETTLED", result: outcome, settled_at: settledAt, first_clear: applied?.firstClear ?? false })
    .eq("id", att.id).eq("user_id", userId).eq("status", "STARTED").select("id");
  if (claim.error?.code === "23505") {
    // Ya hubo una primera victoria registrada para este nodo: esta liquida sin serlo.
    claim = await sb.from("campaign_attempts").update({ status: "SETTLED", result: outcome, settled_at: settledAt, first_clear: false })
      .eq("id", att.id).eq("user_id", userId).eq("status", "STARTED").select("id");
    if (applied) applied.firstClear = false;
  }
  if (claim.error) throw new Error(claim.error.message);
  if (!((claim.data as unknown[] | null) ?? []).length) return { settled: false, reason: "ALREADY_SETTLED", nodeId: att.node_id };

  // Nodo retirado en una versión nueva: el intento queda liquidado, sin progreso ni pago.
  if (!found || !applied) return { settled: true, outcome, firstClear: false, nodeId: att.node_id };

  const n = applied.next;
  const up = await sb.from("campaign_progress").upsert({
    user_id: userId, campaign_id: def.campaignId, node_id: n.nodeId, campaign_version: n.version, status: n.status,
    best_result: n.bestResult, attempts: n.attempts, wins: n.wins,
    first_cleared_at: n.firstClearedAt ? new Date(n.firstClearedAt).toISOString() : null,
    first_clear_match_id: n.firstClearMatchId, updated_at: settledAt,
  }, { onConflict: "user_id,campaign_id,node_id" });
  if (up.error) {
    // Deshacer el reclamo: el intento vuelve a quedar abierto y se reintentará al sincronizar.
    await sb.from("campaign_attempts").update({ status: "STARTED", result: null, settled_at: null, first_clear: false }).eq("id", att.id).eq("user_id", userId);
    throw new Error(up.error.message);
  }

  if (applied.firstClear) await grantFirstClear(sb, userId, def, att);
  return { settled: true, outcome, firstClear: applied.firstClear, nodeId: att.node_id };
}

/**
 * Liquida la campaña de UNA partida terminada. La llama `services/duels.playTurn` al cerrar la partida (con los
 * hechos que ya tiene) y la reconciliación (sin ellos: los lee). Idempotente: la segunda llamada es un no-op.
 */
/**
 * DUEL GAMEPLAY UX 2.0 · RECIBO de la primera victoria que cerró ESTA partida (solo lectura): la clave de concesión
 * (`firstClearRef`) si el intento de esta partida la consiguió y se pagó; `null` en cualquier otro caso. Quien muestra el
 * recibo lee el asiento del libro mayor por esa clave. Nunca concede nada (eso es `award`, idempotente por la clave).
 */
export async function firstClearRefForMatch(sb: SupabaseClient, userId: string, matchId: string): Promise<string | null> {
  const att = await sb.from("campaign_attempts").select("campaign_id, node_id, first_clear, reward_granted").eq("match_id", matchId).eq("user_id", userId).maybeSingle();
  const a = (att.error ? null : att.data) as { campaign_id: string; node_id: string; first_clear: boolean; reward_granted: boolean } | null;
  return a?.first_clear && a.reward_granted ? firstClearRef(a.campaign_id, a.node_id) : null;
}

export async function settleCampaignMatch(
  sb: SupabaseClient, userId: string, matchId: string, known: MatchFacts | null = null, opts: CampaignOptions = {},
): Promise<SettleOutcome> {
  const def = opts.def ?? ROAD_TO_CHAMPIONS;
  const { data, error } = await sb.from("campaign_attempts").select(ATTEMPT_COLS)
    .eq("user_id", userId).eq("match_id", matchId).eq("status", "STARTED").limit(1).maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return { settled: false, reason: "MIGRATION_PENDING" };
    throw new Error(error.message);
  }
  if (!data) return { settled: false, reason: "NO_ATTEMPT" };
  return settleAttempt(sb, userId, data as AttemptRow, known, def, opts.now ?? Date.now());
}

/**
 * Cierra lo pendiente del usuario, acotado: intentos abiertos cuya partida ya terminó o desapareció, reservas
 * huérfanas y pagos de primera victoria que fallaron. Multi-pestaña seguro: todo es condicional.
 */
export async function reconcileCampaign(sb: SupabaseClient, userId: string, opts: CampaignOptions = {}): Promise<{ missing: boolean; settled: SettleOutcome[] }> {
  const def = opts.def ?? ROAD_TO_CHAMPIONS;
  const now = opts.now ?? Date.now();
  const open = await sb.from("campaign_attempts").select(ATTEMPT_COLS).eq("user_id", userId).eq("status", "STARTED").limit(RECONCILE_LIMIT);
  if (open.error) {
    if (isMissingSchema(open.error)) return { missing: true, settled: [] };
    throw new Error(open.error.message);
  }
  const settled: SettleOutcome[] = [];
  for (const att of (open.data as AttemptRow[] | null) ?? []) {
    try {
      if (!att.match_id) {
        if (now - (ts(att.created_at) ?? now) > RESERVATION_TTL_MS) await markAbandoned(sb, userId, att.id);
        continue;
      }
      const r = await settleAttempt(sb, userId, att, null, def, now);
      if (r.settled) settled.push(r);
    } catch (e) {
      console.error(`[campaign] reconciliación del intento ${att.id}: ${(e as Error).message}`);
    }
  }
  const unpaid = await sb.from("campaign_attempts").select(ATTEMPT_COLS)
    .eq("user_id", userId).eq("first_clear", true).eq("reward_granted", false).limit(RECONCILE_LIMIT);
  if (!unpaid.error) for (const att of (unpaid.data as AttemptRow[] | null) ?? []) await grantFirstClear(sb, userId, def, att);
  return { missing: false, settled };
}

/** `action: "sync"` — reconciliar y devolver la foto. Es lo que hace el cliente al volver de una partida. */
export async function syncCampaign(sb: SupabaseClient, userId: string, opts: CampaignOptions = {}): Promise<CampaignResult<CampaignSnapshot>> {
  // Sin 0051 no hay nada que reconciliar: `getCampaign` ya responde «no disponible».
  await reconcileCampaign(sb, userId, opts);
  return getCampaign(sb, userId, opts);
}

export interface AbandonOptions extends CampaignOptions {
  abandon?: (sb: SupabaseClient, userId: string, matchId: string) => Promise<ServiceResult<{ id: string }>>;
}

/**
 * `action: "abandon"` — suelta el nodo en marcha. Si su partida YA terminó, se liquida en vez de borrarla
 * (abandonar nunca se come un resultado). Abandonar no cuenta como intento ni paga nada.
 */
export async function abandonCampaignAttempt(sb: SupabaseClient, userId: string, opts: AbandonOptions = {}): Promise<CampaignResult<CampaignSnapshot>> {
  const def = opts.def ?? ROAD_TO_CHAMPIONS;
  const now = opts.now ?? Date.now();
  const open = await sb.from("campaign_attempts").select(ATTEMPT_COLS).eq("user_id", userId).eq("status", "STARTED").limit(1).maybeSingle();
  if (open.error) return isMissingSchema(open.error) ? fail(503, "MIGRATION_PENDING", UNAVAILABLE_MESSAGE) : fail(500, "DB", open.error.message);
  const att = open.data as AttemptRow | null;
  if (!att) return fail(404, "NO_ATTEMPT", "No tienes ningún nodo en marcha.");

  if (att.match_id) {
    const r = await settleAttempt(sb, userId, att, null, def, now);
    if (r.reason === "IN_PROGRESS") {
      const ab = await (opts.abandon ?? abandonMatch)(sb, userId, att.match_id);
      if (!ab.ok) return fail(500, "DB", ab.error ?? "No se pudo abandonar la partida");
      await markAbandoned(sb, userId, att.id);
    }
  } else {
    await markAbandoned(sb, userId, att.id);
  }
  return getCampaign(sb, userId, opts);
}
