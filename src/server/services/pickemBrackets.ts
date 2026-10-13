/**
 * F87 · PICK'EMS 2.0 — SERVICIO DE JUGADOR (solo servidor).
 *
 *   · Lectura de un ámbito: descriptor congelado + estado REAL de sus partidos + cierres + (con sesión) MIS picks.
 *     El cuadro predicho lo deriva el cliente con el MISMO dominio puro (`domain/pickems/prediction`); el servidor
 *     manda los datos, nunca una predicción «resuelta» de otra persona.
 *   · Guardar un pick: el servidor valida que el equipo es uno de los dos participantes PREDICHOS de ese partido
 *     para ese jugador (con su revisión), calcula qué descendientes quedan incompatibles y llama a la RPC, que decide
 *     el cierre con el reloj de la BD, comprueba la revisión (pestañas/dispositivos) y escribe atómicamente.
 *   · Reclamar: una RPC (exactamente una vez; solo sobre un ámbito LIQUIDADO con recompensas ACTIVAS).
 *   · Clasificación: provisional (calculada aquí desde los picks y los resultados reales) o la foto de liquidación.
 *     Identidad pública = nombre + #TAG. Nunca correo, UUID ni ip.
 *
 * Nada de aquí escribe sobre `matches`, `pickem_answers` ni el libro de créditos directamente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatTag } from "@/domain/account/tag";
import { FORMAT_LABEL, type FormatDescriptor, type RealMatchRow } from "@/domain/pickems/format";
import {
  checkPick, invalidatedBy, pendingPicks, phaseOf, rankRows, realStateOf, scoreEntry,
  type BracketPhase, type PredictionContext, type ScoreSummary,
} from "@/domain/pickems/prediction";
import { isLockedAt, effectiveLockAt } from "@/domain/pickems/locks";
import { describeTierReward, parseRewards, TIER_LABEL, TIER_ORDER, type BracketRewardConfig, type RewardTierId, type TierReward } from "@/domain/pickems/bracketRewards";
import { packLabel } from "@/domain/pickems/ledger";
import type { Eligibility, EligibilityCode } from "@/domain/pickems/eligibility";

export type BracketStatus = "DRAFT" | "PUBLISHED" | "SETTLED" | "CANCELLED";

export interface BracketRow {
  id: string; slug: string; event_id: string; title: string; status: BracketStatus; format_kind: string; stage_ids: string[];
  descriptor: FormatDescriptor; descriptor_checksum: string; admin_edges: unknown; scoring_version: string; max_points: number;
  lock_policy: "MATCH" | "STAGE"; stage_lock_at: string | null; rewards: unknown; rewards_status: string; rewards_version: number;
  version: number; settlement_version: number; published_at: string | null; settled_at: string | null; cancelled_at: string | null;
  created_at: string; updated_at: string;
}
export const BRACKET_COLS = "id, slug, event_id, title, status, format_kind, stage_ids, descriptor, descriptor_checksum, admin_edges, scoring_version, max_points, lock_policy, stage_lock_at, rewards, rewards_status, rewards_version, version, settlement_version, published_at, settled_at, cancelled_at, created_at, updated_at";

export interface NodeRow { match_id: string; points: number; lock_at: string; lock_override_at: string | null; voided_at: string | null; void_reason: string | null }
const NODE_COLS = "match_id, points, lock_at, lock_override_at, voided_at, void_reason";
const MATCH_COLS = "id, event_id, stage_id, round, match_order, best_of, status, start_time, team_a_id, team_b_id, winner_team_id, score_a, score_b, winner_to_match_id, winner_to_slot, loser_to_match_id, loser_to_slot, winner_qualifies, winner_qualifies_label, progression_confidence";

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code?: string; data?: unknown };
const okR = <T>(data: T): Result<T> => ({ ok: true, data });
const failR = (status: number, error: string, code?: string, data?: unknown): Result<never> => ({ ok: false, status, error, code, data });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/* ═══════════════════════════════ CARGA ═══════════════════════════════ */

export interface Loaded {
  bracket: BracketRow;
  nodes: NodeRow[];
  matches: RealMatchRow[];
  eventName: string | null;
}

/** Ámbito por id o slug, con sus nodos y los partidos REALES del descriptor (un lote, sin N+1). */
export async function loadBracket(sb: SupabaseClient, idOrSlug: string, opts: { includeDraft?: boolean } = {}): Promise<Loaded | null> {
  if (!idOrSlug || (!UUID.test(idOrSlug) && !SLUG.test(idOrSlug))) return null;
  const q = sb.from("pickem_brackets").select(BRACKET_COLS);
  const { data, error } = await (UUID.test(idOrSlug) ? q.eq("id", idOrSlug) : q.eq("slug", idOrSlug)).maybeSingle();
  if (error) throw new Error(error.message);
  const bracket = data as unknown as BracketRow | null;
  if (!bracket || (bracket.status === "DRAFT" && !opts.includeDraft)) return null;
  const ids = (bracket.descriptor?.nodes ?? []).map((n) => n.matchId);
  const [nodesRes, matchesRes, eventRes] = await Promise.all([
    sb.from("pickem_bracket_matches").select(NODE_COLS).eq("bracket_id", bracket.id),
    ids.length ? sb.from("matches").select(MATCH_COLS).in("id", ids) : Promise.resolve({ data: [], error: null }),
    sb.from("events").select("name").eq("id", bracket.event_id).maybeSingle(),
  ]);
  if (nodesRes.error) throw new Error(nodesRes.error.message);
  if (matchesRes.error) throw new Error(matchesRes.error.message);
  const rows = (matchesRes.data ?? []) as unknown as RealMatchRow[];
  // Nombres de equipo por id canónico (el nombre es etiqueta; la identidad es el id).
  const teamIds = [...new Set(rows.flatMap((m) => [m.team_a_id, m.team_b_id]).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (teamIds.length) {
    const { data: teams } = await sb.from("teams").select("id, name").in("id", teamIds);
    for (const t of (teams ?? []) as { id: string; name: string }[]) names.set(t.id, t.name);
  }
  const matches = rows.map((m) => ({ ...m, team_a: m.team_a_id ? names.get(m.team_a_id) ?? null : null, team_b: m.team_b_id ? names.get(m.team_b_id) ?? null : null }));
  return { bracket, nodes: (nodesRes.data ?? []) as NodeRow[], matches, eventName: (eventRes.data as { name: string } | null)?.name ?? null };
}

export function lockOf(l: Loaded, matchId: string) {
  const node = l.nodes.find((n) => n.match_id === matchId);
  const real = l.matches.find((m) => m.id === matchId);
  const input = {
    bracketStatus: l.bracket.status, lockPolicy: l.bracket.lock_policy, stageLockAt: l.bracket.stage_lock_at,
    lockAt: node?.lock_at ?? real?.start_time ?? new Date(0).toISOString(), lockOverrideAt: node?.lock_override_at ?? null,
    voided: !!node?.voided_at, realStatus: real ? real.status : null, realStart: real?.start_time ?? null,
  };
  return { input, node, real };
}

export function contextOf(l: Loaded): PredictionContext {
  return {
    descriptor: l.bracket.descriptor,
    real: realStateOf(l.matches),
    voided: new Set(l.nodes.filter((n) => n.voided_at).map((n) => n.match_id)),
  };
}

export const isOpenFn = (l: Loaded, now: number) => (matchId: string): boolean => {
  if (l.bracket.status !== "PUBLISHED") return false;
  const { input, node } = lockOf(l, matchId);
  return !!node && !isLockedAt(input, now);
};

async function loadEntry(sb: SupabaseClient, bracketId: string, userId: string) {
  const [e, p] = await Promise.all([
    sb.from("pickem_bracket_entries").select("revision, final_points, final_correct, final_wrong, final_missed, final_void, final_completion, final_ratio, final_perfect, final_tier, final_position, settled_version").eq("bracket_id", bracketId).eq("user_id", userId).maybeSingle(),
    sb.from("pickem_bracket_picks").select("match_id, team_id").eq("bracket_id", bracketId).eq("user_id", userId),
  ]);
  if (e.error) throw new Error(e.error.message);
  if (p.error) throw new Error(p.error.message);
  const picks: Record<string, string> = {};
  for (const r of (p.data ?? []) as { match_id: string; team_id: string }[]) picks[r.match_id] = r.team_id;
  return { entry: e.data as EntryRow | null, picks };
}

interface EntryRow {
  revision: number; final_points: number | null; final_correct: number | null; final_wrong: number | null; final_missed: number | null;
  final_void: number | null; final_completion: number | string | null; final_ratio: number | string | null; final_perfect: boolean | null;
  final_tier: RewardTierId | null; final_position: number | null; settled_version: number | null;
}

/* ═══════════════════════════════ VISTA ═══════════════════════════════ */

export interface PublicTier { id: RewardTierId; label: string; minRatio: number | null; items: string[]; reward: TierReward }
export interface PublicRewards { status: "ACTIVE"; minCompletion: number; version: number; tiers: PublicTier[] }

export interface NodeState {
  matchId: string;
  lockAt: string | null;
  locked: boolean;
  voided: boolean;
  points: number;
}

export interface LeaderRowPublic { position: number; username: string; tag: string | null; points: number; correct: number; me?: boolean }

export interface MyBracket {
  revision: number;
  picks: Record<string, string>;
  score: Pick<ScoreSummary, "points" | "maxPoints" | "correct" | "wrong" | "missed" | "voided" | "pending" | "picked" | "scorable" | "completion" | "ratio" | "perfect" | "decided">;
  pending: number;
  /** Escalón según la foto de liquidación (solo SETTLED). */
  tier: RewardTierId | null;
  position: number | null;
  claim: { tier: RewardTierId; claimedAt: string; items: string[] } | null;
  claimable: boolean;
  /**
   * F87.2 · ¿puede ESTA cuenta cobrar en este Pick'em? Solo con recompensas ACTIVAS (si no, `null`). La calcula la BD
   * (`app_pickem_reward_eligibility`) y no cambia el escalón: un perfecto sigue siendo perfecto aunque no cobre.
   */
  rewardEligibility: Eligibility | null;
}

export interface BracketView {
  id: string; slug: string; title: string; eventId: string; eventName: string | null;
  status: BracketStatus; phase: BracketPhase; formatKind: string; formatLabel: string;
  descriptor: FormatDescriptor;
  matches: RealMatchRow[];
  nodes: NodeState[];
  maxPoints: number;
  scoringVersion: string;
  nextLockAt: string | null;
  serverNow: string;
  /** Solo ACTIVAS. OFF/BORRADOR = `null` y `rewardsNote` lo dice (nada ambiguo). */
  rewards: PublicRewards | null;
  rewardsNote: string;
  leaderboard: { participants: number; rows: LeaderRowPublic[]; me: LeaderRowPublic | null; provisional: boolean };
  me: MyBracket | null;
}

export function publicRewards(cfg: BracketRewardConfig): PublicRewards | null {
  if (cfg.status !== "ACTIVE") return null;
  return {
    status: "ACTIVE", minCompletion: cfg.minCompletion, version: cfg.version,
    tiers: TIER_ORDER.map((id) => cfg.tiers.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => ({ id: t.id, label: TIER_LABEL[t.id], minRatio: t.minRatio, reward: t.reward, items: describeTierReward(t.reward, packLabel) })),
  };
}

/** Datos PÚBLICOS del ámbito (sin nada de ningún jugador salvo la clasificación con identidad pública). */
async function publicPart(sb: SupabaseClient, l: Loaded, now: number) {
  const ctx = contextOf(l);
  const isOpen = isOpenFn(l, now);
  const nodes: NodeState[] = l.bracket.descriptor.nodes.map((n) => {
    const { input, node } = lockOf(l, n.matchId);
    const at = node ? effectiveLockAt(input) : null;
    return { matchId: n.matchId, lockAt: at === null ? null : new Date(at).toISOString(), locked: !isOpen(n.matchId), voided: !!node?.voided_at, points: node?.points ?? n.points };
  });
  const future = nodes.filter((n) => !n.locked && n.lockAt).map((n) => Date.parse(n.lockAt!)).sort((a, b) => a - b);
  const allDecided = l.bracket.descriptor.nodes.every((n) => ctx.voided?.has(n.matchId) || ctx.real.get(n.matchId)?.final);
  const anyOpen = nodes.some((n) => !n.locked);
  const anyPickable = pendingPicks(ctx, {}, isOpen).length > 0;
  const phase = phaseOf(l.bracket.status, { anyOpen, anyPickable, allDecided });
  const leaderboard = await leaderboardOf(sb, l, now);
  return { nodes, nextLockAt: future.length ? new Date(future[0]).toISOString() : null, phase, leaderboard };
}

/** Clasificación: foto de liquidación (SETTLED) o provisional calculada desde los picks y los resultados reales. */
export async function leaderboardOf(sb: SupabaseClient, l: Loaded, now: number): Promise<{ participants: number; all: (LeaderRowPublic & { userId: string })[]; provisional: boolean }> {
  const settled = l.bracket.status === "SETTLED";
  let scored: { userId: string; points: number; correct: number }[];
  if (settled) {
    const { data, error } = await sb.from("pickem_bracket_entries").select("user_id, final_points, final_correct").eq("bracket_id", l.bracket.id);
    if (error) throw new Error(error.message);
    scored = ((data ?? []) as { user_id: string; final_points: number | null; final_correct: number | null }[]).map((r) => ({ userId: r.user_id, points: r.final_points ?? 0, correct: r.final_correct ?? 0 }));
  } else {
    const { data, error } = await sb.from("pickem_bracket_picks").select("user_id, match_id, team_id").eq("bracket_id", l.bracket.id).limit(50_000);
    if (error) throw new Error(error.message);
    const byUser = new Map<string, Record<string, string>>();
    for (const r of (data ?? []) as { user_id: string; match_id: string; team_id: string }[]) {
      const m = byUser.get(r.user_id) ?? {}; m[r.match_id] = r.team_id; byUser.set(r.user_id, m);
    }
    const ctx = contextOf(l);
    const isOpen = isOpenFn(l, now);
    scored = [...byUser.entries()].map(([userId, picks]) => {
      const s = scoreEntry(ctx, picks, (id) => !isOpen(id));
      return { userId, points: s.points, correct: s.correct };
    });
  }
  const ranked = rankRows(scored);
  const ids = ranked.map((r) => r.userId);
  const identity = new Map<string, { username: string; tag: string | null }>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await sb.from("profiles").select("id, username, public_tag").in("id", ids.slice(i, i + 500));
    for (const p of (data ?? []) as { id: string; username: string | null; public_tag: string | null }[]) identity.set(p.id, { username: p.username ?? "Jugador", tag: p.public_tag ? formatTag(p.public_tag) : null });
  }
  return {
    participants: ranked.length, provisional: !settled,
    all: ranked.map((r) => ({ userId: r.userId, position: r.position, points: r.points, correct: r.correct, username: identity.get(r.userId)?.username ?? "Jugador", tag: identity.get(r.userId)?.tag ?? null })),
  };
}

const strip = ({ userId: _u, ...rest }: LeaderRowPublic & { userId: string }): LeaderRowPublic => rest;

export async function getBracketView(sb: SupabaseClient, idOrSlug: string | null, viewer: string | null, now = Date.now()): Promise<Result<BracketView>> {
  if (!idOrSlug) return failR(400, "Falta el Pick'em", "BAD_REQUEST");
  const l = await loadBracket(sb, idOrSlug);
  if (!l) return failR(404, "Pick'em no encontrado", "NOT_FOUND");
  const pub = await publicPart(sb, l, now);
  const cfg = parseRewards(l.bracket.rewards);
  const rewards = publicRewards(cfg);
  const meRow = viewer ? pub.leaderboard.all.find((r) => r.userId === viewer) ?? null : null;
  let me: MyBracket | null = null;
  if (viewer) {
    const { entry, picks } = await loadEntry(sb, l.bracket.id, viewer);
    const ctx = contextOf(l);
    const isOpen = isOpenFn(l, now);
    const s = scoreEntry(ctx, picks, (id) => !isOpen(id));
    let claim: MyBracket["claim"] = null;
    if (l.bracket.status === "SETTLED") {
      const { data } = await sb.from("pickem_bracket_claims").select("tier, claimed_at, reward").eq("bracket_id", l.bracket.id).eq("user_id", viewer).maybeSingle();
      const c = data as { tier: RewardTierId; claimed_at: string; reward: TierReward } | null;
      if (c) claim = { tier: c.tier, claimedAt: c.claimed_at, items: describeTierReward(c.reward, packLabel) };
    }
    const tier = l.bracket.status === "SETTLED" ? entry?.final_tier ?? null : null;
    const rewardEligibility = rewards ? await rewardEligibilityOf(sb, viewer, l.bracket.id) : null;
    me = {
      revision: entry?.revision ?? 0, picks,
      score: { points: s.points, maxPoints: s.maxPoints, correct: s.correct, wrong: s.wrong, missed: s.missed, voided: s.voided, pending: s.pending, picked: s.picked, scorable: s.scorable, completion: s.completion, ratio: s.ratio, perfect: s.perfect, decided: s.decided },
      pending: pendingPicks(ctx, picks, isOpen).length,
      tier, position: l.bracket.status === "SETTLED" ? entry?.final_position ?? null : meRow?.position ?? null,
      claim, claimable: !!rewards && l.bracket.status === "SETTLED" && !!tier && !claim && !!rewardEligibility?.eligible,
      rewardEligibility,
    };
  }
  return okR({
    id: l.bracket.id, slug: l.bracket.slug, title: l.bracket.title, eventId: l.bracket.event_id, eventName: l.eventName,
    status: l.bracket.status, phase: pub.phase, formatKind: l.bracket.format_kind,
    formatLabel: FORMAT_LABEL[l.bracket.format_kind as keyof typeof FORMAT_LABEL] ?? l.bracket.format_kind,
    descriptor: l.bracket.descriptor, matches: l.matches, nodes: pub.nodes, maxPoints: l.bracket.max_points,
    scoringVersion: l.bracket.scoring_version, nextLockAt: pub.nextLockAt, serverNow: new Date(now).toISOString(),
    rewards,
    rewardsNote: rewards ? "Recompensas confirmadas: se reclaman cuando el Pick'em se liquida."
      : "Recompensas aún no activadas para este Pick'em. Cuenta para la clasificación.",
    leaderboard: {
      participants: pub.leaderboard.participants, provisional: pub.leaderboard.provisional,
      rows: pub.leaderboard.all.slice(0, 50).map((r) => (viewer && r.userId === viewer ? { ...strip(r), me: true } : strip(r))),
      me: meRow ? { ...strip(meRow), me: true } : null,
    },
    me,
  });
}

/* ═══════════════════════════════ LISTA · MIS PICK'EMS ═══════════════════════════════ */

export interface BracketCard {
  id: string; slug: string; title: string; eventName: string | null; status: BracketStatus; phase: BracketPhase;
  formatLabel: string; nextLockAt: string | null; matches: number; hasRewards: boolean;
  mine: { picked: number; pending: number; points: number; claimable: boolean; claimed: boolean } | null;
}

export async function listBrackets(sb: SupabaseClient, viewer: string | null, now = Date.now()): Promise<Result<{ brackets: BracketCard[] }>> {
  const { data, error } = await sb.from("pickem_brackets").select("id").in("status", ["PUBLISHED", "SETTLED", "CANCELLED"]).order("published_at", { ascending: false }).limit(30);
  if (error) {
    if (/pickem_brackets|does not exist|PGRST205/i.test(error.message)) return okR({ brackets: [] });
    throw new Error(error.message);
  }
  const out: BracketCard[] = [];
  for (const { id } of (data ?? []) as { id: string }[]) {
    const l = await loadBracket(sb, id);
    if (!l) continue;
    const ctx = contextOf(l);
    const isOpen = isOpenFn(l, now);
    const nodes = l.bracket.descriptor.nodes;
    const open = nodes.filter((n) => isOpen(n.matchId));
    const nextLock = open.map((n) => effectiveLockAt(lockOf(l, n.matchId).input)).filter((x): x is number => x !== null).sort((a, b) => a - b)[0] ?? null;
    const allDecided = nodes.every((n) => ctx.voided?.has(n.matchId) || ctx.real.get(n.matchId)?.final);
    const phase = phaseOf(l.bracket.status, { anyOpen: open.length > 0, anyPickable: pendingPicks(ctx, {}, isOpen).length > 0, allDecided });
    let mine: BracketCard["mine"] = null;
    if (viewer) {
      const { entry, picks } = await loadEntry(sb, id, viewer);
      if (entry) {
        const s = scoreEntry(ctx, picks, (mid) => !isOpen(mid));
        let claimed = false;
        if (l.bracket.status === "SETTLED") {
          const { data: c } = await sb.from("pickem_bracket_claims").select("tier").eq("bracket_id", id).eq("user_id", viewer).maybeSingle();
          claimed = !!c;
        }
        const candidate = l.bracket.status === "SETTLED" && l.bracket.rewards_status === "ACTIVE" && !!entry.final_tier && !claimed;
        mine = {
          picked: s.picked, pending: pendingPicks(ctx, picks, isOpen).length, points: l.bracket.status === "SETTLED" ? entry.final_points ?? s.points : s.points,
          claimable: candidate && (await rewardEligibilityOf(sb, viewer, id)).eligible, claimed,
        };
      }
    }
    out.push({
      id, slug: l.bracket.slug, title: l.bracket.title, eventName: l.eventName, status: l.bracket.status, phase,
      formatLabel: FORMAT_LABEL[l.bracket.format_kind as keyof typeof FORMAT_LABEL] ?? l.bracket.format_kind,
      nextLockAt: nextLock === null ? null : new Date(nextLock).toISOString(), matches: nodes.length,
      hasRewards: l.bracket.rewards_status === "ACTIVE", mine,
    });
  }
  return okR({ brackets: out });
}

/* ═══════════════════════════════ ESCRITURAS ═══════════════════════════════ */

const PICK_ERRORS: Record<string, [number, string]> = {
  PICKEM_NOT_FOUND: [404, "Pick'em no encontrado"],
  PICKEM_NOT_OPEN: [409, "Este Pick'em no admite predicciones"],
  PICKEM_BAD_MATCH: [400, "Partido no válido en este Pick'em"],
  PICKEM_LOCKED: [409, "Esta predicción ya está cerrada"],
  PICKEM_BAD_TEAM: [400, "Equipo no válido"],
  PICKEM_NOT_SETTLED: [409, "El Pick'em aún no está liquidado"],
  PICKEM_NO_REWARDS: [409, "Este Pick'em no tiene recompensas activas"],
  PICKEM_NOT_ELIGIBLE: [409, "No has conseguido ninguna recompensa en este Pick'em"],
  PICKEM_TIER_MISSING: [409, "Recompensa no disponible"],
  PICKEM_LEDGER_CONFLICT: [409, "Recompensa ya registrada"],
  PICKEM_LEGACY_AUTHORITY: [409, "Este evento se premia por su Pick'em clásico"],
  PICKEM_REWARD_INELIGIBLE: [403, "Puedes participar, pero esta cuenta todavía no cumple los requisitos para recibir recompensas."],
};

const ELIGIBILITY_CODES: readonly EligibilityCode[] = ["ELIGIBLE", "ACCOUNT_TOO_NEW", "NOT_ENOUGH_MATCHES", "ACCOUNT_TOO_NEW_AND_NOT_ENOUGH_MATCHES", "POLICY_MISSING", "NO_REFERENCE", "NO_ACCOUNT"];
/**
 * F87.2 · elegibilidad de la cuenta para cobrar, calculada por la BD (autoridad). Cualquier fallo de lectura, RPC
 * ausente (BD sin 0073) o código desconocido → NO elegible (falla cerrada). El cliente nunca la envía.
 */
export async function rewardEligibilityOf(sb: SupabaseClient, userId: string, bracketId: string): Promise<Eligibility> {
  const closed: Eligibility = { eligible: false, code: "POLICY_MISSING", policy: null, referenceAt: null, ageOkFrom: null, matches: 0, matchesRequired: 0, final: false };
  const { data, error } = await sb.rpc("app_pickem_reward_eligibility", { p_user: userId, p_bracket: bracketId });
  const d = (!error && data && typeof data === "object" ? data : null) as Record<string, unknown> | null;
  if (!d || !ELIGIBILITY_CODES.includes(d.code as EligibilityCode)) return closed;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    eligible: d.eligible === true && d.code === "ELIGIBLE", code: d.code as EligibilityCode, policy: str(d.policy),
    referenceAt: str(d.referenceAt), ageOkFrom: str(d.ageOkFrom), matches: Number(d.matches ?? 0) || 0,
    matchesRequired: Number(d.matchesRequired ?? 0) || 0, final: d.final === true,
  };
}
function rpcFail(message: string | undefined): Result<never> {
  const m = message ?? "";
  const hit = Object.keys(PICK_ERRORS).find((k) => m.includes(k));
  if (hit) return failR(PICK_ERRORS[hit][0], PICK_ERRORS[hit][1], hit.replace("PICKEM_", ""));
  throw new Error(m || "rpc");
}

export interface SaveResult { revision: number; picks: Record<string, string>; cleared: string[] }

/**
 * Guarda (o quita, `teamId = null`) el pick de un partido. `expectedRevision` es la que el cliente tenía: si otra
 * pestaña o dispositivo guardó antes, 409 STALE con el estado fresco (nada se pisa).
 */
export async function savePick(
  sb: SupabaseClient, userId: string, idOrSlug: string, matchId: string, teamId: string | null, expectedRevision: number | null, now = Date.now(),
): Promise<Result<SaveResult>> {
  const l = await loadBracket(sb, idOrSlug);
  if (!l) return failR(404, "Pick'em no encontrado", "NOT_FOUND");
  if (l.bracket.status !== "PUBLISHED") return failR(409, "Este Pick'em no admite predicciones", "NOT_OPEN");
  if (!l.bracket.descriptor.nodes.some((n) => n.matchId === matchId)) return failR(400, "Partido no válido en este Pick'em", "BAD_MATCH");
  const { entry, picks } = await loadEntry(sb, l.bracket.id, userId);
  const revision = entry?.revision ?? 0;
  if (expectedRevision !== null && expectedRevision !== revision) return failR(409, "Tus predicciones cambiaron en otra pestaña", "STALE", { revision, picks });
  const isOpen = isOpenFn(l, now);
  if (!isOpen(matchId)) return failR(409, "Esta predicción ya está cerrada", "LOCKED");
  const ctx = contextOf(l);
  if (teamId !== null) {
    const chk = checkPick(ctx, picks, matchId, teamId);
    if (!chk.ok) {
      const msg = chk.code === "PARTICIPANTS_UNKNOWN" ? "Aún no se sabe quién juega este partido en tu cuadro" : chk.code === "VOID" ? "Partido anulado" : "Ese equipo no juega este partido en tu cuadro";
      return failR(400, msg, chk.code);
    }
  }
  const { cleared } = invalidatedBy(ctx, picks, matchId, teamId, isOpen);
  const { data, error } = await sb.rpc("app_pickem_save_pick", {
    p_user: userId, p_bracket: l.bracket.id, p_match: matchId, p_team: teamId, p_expected_revision: revision, p_clear: cleared,
  });
  if (error) return rpcFail(error.message);
  const res = data as { ok: boolean; code?: string; revision: number; cleared?: string[] };
  const fresh = await loadEntry(sb, l.bracket.id, userId);
  if (!res.ok) return failR(409, "Tus predicciones cambiaron en otra pestaña", "STALE", { revision: res.revision, picks: fresh.picks });
  return okR({ revision: res.revision, picks: fresh.picks, cleared: res.cleared ?? [] });
}

export async function claimBracket(sb: SupabaseClient, userId: string, idOrSlug: string): Promise<Result<{ applied: boolean; tier: RewardTierId; items: string[] }>> {
  const l = await loadBracket(sb, idOrSlug);
  if (!l) return failR(404, "Pick'em no encontrado", "NOT_FOUND");
  const { data, error } = await sb.rpc("app_pickem_claim", { p_user: userId, p_bracket: l.bracket.id });
  if (error) return rpcFail(error.message);
  const r = data as { applied: boolean; tier: RewardTierId; reward: TierReward };
  return okR({ applied: !!r.applied, tier: r.tier, items: describeTierReward(r.reward ?? {}, packLabel) });
}

/** Para el vestíbulo: partidos abiertos por predecir en los ámbitos publicados (con sesión). Barato: lote pequeño. */
export async function pendingBracketPicks(sb: SupabaseClient, userId: string, now = Date.now()): Promise<{ pending: number; title: string | null; slug: string | null; nextLockAt: number | null } | null> {
  const { data, error } = await sb.from("pickem_brackets").select("id").eq("status", "PUBLISHED").limit(5);
  if (error || !data?.length) return null;
  let best: { pending: number; title: string | null; slug: string | null; nextLockAt: number | null } | null = null;
  for (const { id } of data as { id: string }[]) {
    const l = await loadBracket(sb, id);
    if (!l) continue;
    const { picks } = await loadEntry(sb, id, userId);
    const isOpen = isOpenFn(l, now);
    const pend = pendingPicks(contextOf(l), picks, isOpen);
    if (pend.length === 0) continue;
    const next = pend.map((m) => effectiveLockAt(lockOf(l, m).input)).filter((x): x is number => x !== null).sort((a, b) => a - b)[0] ?? null;
    if (!best || (next ?? Infinity) < (best.nextLockAt ?? Infinity)) best = { pending: pend.length, title: l.bracket.title, slug: l.bracket.slug, nextLockAt: next };
  }
  return best;
}
