/**
 * F87 · PICK'EMS 2.0 EN EL PANEL (`/admin/pickems`, `/api/admin/pickems`). Admin EXISTENTE: `runAdmin` → `verifyAdmin`
 * (profiles.is_admin), límites admin_read/admin_write y lista blanca del cuerpo. Las RPC de 0071 vuelven a comprobar
 * en la BD que el actor es admin y AUDITAN cada acción en `content_audit_log` (entity_type = 'pickem_bracket').
 *
 *   · Borrador desde un evento REAL + fases: el formato y el grafo se DERIVAN (fuente 0045 + lo que el formato
 *     determina sin ambigüedad). Donde la fuente calla (cruces de perdedores de un doble), el admin define aristas
 *     sobre partidos reales existentes. Nunca crea partidos, equipos ni resultados.
 *   · Validador = puerta de publicación: con un solo ERROR no se publica. Publicar exige además que lo guardado
 *     coincida con lo que hoy deriva la fuente (si la fuente cambió, «Refrescar» primero: nada se remapea en silencio).
 *   · Deriva de la fuente tras publicar: se DETECTA y se enseña (partidos que faltan, semillas cambiadas, picks
 *     afectados); el ámbito publicado no se re-estructura (se cancela si hace falta).
 *   · Recompensas: OFF / BORRADOR / ACTIVAS, validadas contra el catálogo real (sobres, cartas, insignias), con
 *     valor por escalón, pasivo máximo y simulación; activar exige aceptar el pasivo. Se congelan al primer cierre.
 *   · Partido: cerrar ya, reprogramar (reabrir) y anular — con motivo. Liquidar — la puntuación la calcula la BD.
 */
import { createHash } from "node:crypto";
import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, json, ok, readBody, respond, runAdmin, type AdminDeps, type AdminResult } from "./http";
import {
  canonicalDescriptor, deriveFormat, hasBlockingIssues, SUPPORTED_FORMATS, validateFormat, FORMAT_LABEL,
  type FormatDescriptor, type FormatEdge, type FormatIssue, type PickemFormatKind, type RealMatchRow, type StageRow,
} from "@/domain/pickems/format";
import { scoreEntry } from "@/domain/pickems/prediction";
import {
  canonicalRewards, isRewardRulesV1, liabilityOf, parseRewards, rewardRulesV1, REWARD_RULES_V1, tierFor, tierValue, validateRewards, TIER_LABEL,
  type BracketRewardConfig, type CatalogLookup, type RewardIssue, type RewardTierId,
} from "@/domain/pickems/bracketRewards";
import { simulateTiers, type SimResult } from "@/domain/pickems/economy";
import { getPack } from "@/data/packs";
import { getCard } from "@/data/catalog";
import { readHealth } from "@/lib/esports/autosync/health";
import { BRACKET_COLS, contextOf, isOpenFn, loadBracket, lockOf, type BracketRow, type Loaded } from "@/server/services/pickemBrackets";
import { effectiveLockAt } from "@/domain/pickems/locks";
import { launchReadiness, rewardConfigBlockers, timeBlockers, type LaunchNode, type LaunchReadiness } from "@/domain/pickems/launch";
import { isUuid } from "@/domain/admin/sanctions";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MATCH_COLS = "id, event_id, stage_id, round, match_order, best_of, status, start_time, team_a_id, team_b_id, winner_team_id, score_a, score_b, winner_to_match_id, winner_to_slot, loser_to_match_id, loser_to_slot, winner_qualifies, winner_qualifies_label, progression_confidence";

export const CATALOG: CatalogLookup = {
  packPrice: (id) => { const p = getPack(id); return p ? p.price : null; },
  cardExists: (id) => !!getCard(id),
};

/* ═══════════════════════════════ LECTURA DE DATOS REALES ═══════════════════════════════ */

async function realScope(sb: SupabaseClient, eventId: string, stageIds: string[]): Promise<{ stages: StageRow[]; matches: RealMatchRow[] }> {
  const { data: st, error: se } = await sb.from("stages").select("id, name, slug, kind, order_idx").eq("event_id", eventId).in("id", stageIds);
  if (se) throw new Error(se.message);
  const { data: ms, error: me } = await sb.from("matches").select(MATCH_COLS).eq("event_id", eventId).in("stage_id", stageIds);
  if (me) throw new Error(me.message);
  const rows = (ms ?? []) as unknown as RealMatchRow[];
  const teamIds = [...new Set(rows.flatMap((m) => [m.team_a_id, m.team_b_id]).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (teamIds.length) {
    const { data: teams } = await sb.from("teams").select("id, name").in("id", teamIds);
    for (const t of (teams ?? []) as { id: string; name: string }[]) names.set(t.id, t.name);
  }
  return { stages: (st ?? []) as StageRow[], matches: rows.map((m) => ({ ...m, team_a: m.team_a_id ? names.get(m.team_a_id) ?? null : null, team_b: m.team_b_id ? names.get(m.team_b_id) ?? null : null })) };
}

function parseAdminEdges(raw: unknown): Omit<FormatEdge, "origin">[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 64) return null;
  const out: Omit<FormatEdge, "origin">[] = [];
  for (const e of raw) {
    const x = (e ?? {}) as Record<string, unknown>;
    if (typeof x.from !== "string" || typeof x.to !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(x.from) || !/^[A-Za-z0-9_-]{1,64}$/.test(x.to)) return null;
    if (x.source !== "WINNER" && x.source !== "LOSER") return null;
    const slot = x.slot === 1 || x.slot === 2 ? x.slot : null;
    out.push({ from: x.from, to: x.to, source: x.source, slot });
  }
  return out;
}

/* ═══════════════════════════════ LISTA ═══════════════════════════════ */

export interface AdminBracketRow { id: string; slug: string; title: string; eventId: string; status: string; formatLabel: string; nodes: number; rewardsStatus: string; participants: number; version: number; updatedAt: string }

/** F87.1 · Pick'em LEGACY (0012): solo lectura en el panel, con su clasificación del corte (0072). */
export interface AdminLegacyRow { id: string; eventId: string; eventName: string | null; title: string; status: string; legacyMode: string; questions: number; openQuestions: number; submissions: number; rewardsPaid: number }

/** F87.1 · ¿tiene el evento un Pick'em legacy vigente? Entonces SUS recompensas son legacy y Pick'ems 2.0 no premia. */
export async function hasLegacyAuthority(sb: SupabaseClient, eventId: string): Promise<boolean> {
  const { data, error } = await sb.from("pickem_events").select("id").eq("event_id", eventId).eq("legacy_mode", "LEGACY_V1").limit(1);
  if (error) return true; // sin poder clasificar → se trata como legacy: nunca se activa por duda (falla cerrada)
  return (data ?? []).length > 0;
}

export async function listLegacy(sb: SupabaseClient, now = Date.now()): Promise<AdminLegacyRow[]> {
  const { data, error } = await sb.from("pickem_events").select("id, event_id, title, status, legacy_mode").order("created_at", { ascending: true }).limit(100);
  if (error) return [];
  const out: AdminLegacyRow[] = [];
  for (const p of (data ?? []) as { id: string; event_id: string; title: string; status: string; legacy_mode: string }[]) {
    const [ev, qs, subs, paid] = await Promise.all([
      sb.from("events").select("name").eq("id", p.event_id).maybeSingle(),
      sb.from("pickem_questions").select("locks_at").eq("pickem_event_id", p.id).limit(500),
      sb.from("pickem_submissions").select("id", { count: "exact", head: true }).eq("pickem_event_id", p.id),
      sb.from("credit_transactions").select("id", { count: "exact", head: true }).like("ref", `pickem:${p.id}:%`),
    ]);
    const q = (qs.data ?? []) as { locks_at: string }[];
    out.push({
      id: p.id, eventId: p.event_id, eventName: (ev.data as { name: string } | null)?.name ?? null, title: p.title, status: p.status, legacyMode: p.legacy_mode ?? "LEGACY_V1",
      questions: q.length, openQuestions: q.filter((x) => Date.parse(x.locks_at) > now).length, submissions: subs.count ?? 0, rewardsPaid: paid.count ?? 0,
    });
  }
  return out;
}

export async function listAdmin(sb: SupabaseClient): Promise<AdminResult<{ brackets: AdminBracketRow[]; legacy: AdminLegacyRow[]; events: { id: string; name: string; status: string; stages: { id: string; name: string; kind: string | null; matches: number; detected: string | null }[] }[]; sync: Awaited<ReturnType<typeof readHealth>> }>> {
  const { data, error } = await sb.from("pickem_brackets").select(BRACKET_COLS).order("created_at", { ascending: false }).limit(100);
  if (error) {
    if (/pickem_brackets|does not exist|PGRST205/i.test(error.message)) return fail(503, "Pick'ems 2.0 aún no está disponible (falta la migración 0071)");
    return fail(500, "No se pudieron leer los Pick'ems");
  }
  const rows = (data ?? []) as unknown as BracketRow[];
  const counts = new Map<string, number>();
  if (rows.length) {
    const { data: es } = await sb.from("pickem_bracket_entries").select("bracket_id").in("bracket_id", rows.map((r) => r.id));
    for (const e of (es ?? []) as { bracket_id: string }[]) counts.set(e.bracket_id, (counts.get(e.bracket_id) ?? 0) + 1);
  }
  const { data: evs } = await sb.from("events").select("id, name, status, start_date").order("start_date", { ascending: false, nullsFirst: false }).limit(20);
  const events = [];
  for (const ev of (evs ?? []) as { id: string; name: string; status: string }[]) {
    const { data: st } = await sb.from("stages").select("id, name, slug, kind, order_idx").eq("event_id", ev.id).order("order_idx");
    const { data: ms } = await sb.from("matches").select("stage_id, round, status").eq("event_id", ev.id);
    const stages = ((st ?? []) as StageRow[]).map((s) => {
      const own = ((ms ?? []) as { stage_id: string; round: string | null; status: string }[]).filter((m) => m.stage_id === s.id);
      const det = deriveFormat({ eventId: ev.id, stages: [s], matches: own.map((m, i) => ({ id: `x${i}`, stage_id: s.id, round: m.round, match_order: i, status: m.status, start_time: null, team_a_id: null, team_b_id: null, winner_team_id: null, score_a: null, score_b: null })) }).detected;
      return { id: s.id, name: s.name, kind: s.kind, matches: own.length, detected: det };
    });
    events.push({ id: ev.id, name: ev.name, status: ev.status, stages });
  }
  return ok({
    brackets: rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title, eventId: r.event_id, status: r.status, formatLabel: FORMAT_LABEL[r.format_kind as PickemFormatKind] ?? r.format_kind, nodes: r.descriptor?.nodes?.length ?? 0, rewardsStatus: r.rewards_status, participants: counts.get(r.id) ?? 0, version: r.version, updatedAt: r.updated_at })),
    legacy: await listLegacy(sb), events, sync: await readHealth(sb),
  });
}

/* ═══════════════════════════════ FICHA ═══════════════════════════════ */

export interface AdminNode {
  matchId: string; section: string; roundLabel: string; column: number; points: number; teamA: string | null; teamB: string | null;
  realStatus: string | null; start: string | null; lockAt: string | null; locked: boolean; voided: boolean; voidReason: string | null; overridden: boolean;
  winner: string | null; pickCount: number;
}

export interface AdminEconomy {
  participants: number;
  perTier: { id: RewardTierId; label: string; value: number }[];
  maxTierValue: number;
  worstCaseParticipants: number;
  worstCase1000: number;
  provisional: Record<RewardTierId | "NONE", number> | null;
  provisionalValue: number | null;
  simulation: SimResult[];
  warnings: string[];
}

export interface AdminDetail {
  bracket: Omit<BracketRow, "descriptor" | "rewards"> & { formatLabel: string };
  descriptor: FormatDescriptor;
  issues: FormatIssue[];
  drift: { checksumNow: string | null; changed: boolean; notes: string[]; affectedPicks: number };
  nodes: AdminNode[];
  participants: number;
  completion: { complete: number; partial: number; empty: number };
  rewards: BracketRewardConfig;
  rewardIssues: RewardIssue[];
  economy: AdminEconomy;
  audit: { at: string; action: string; actorName: string | null; detail: Record<string, unknown> }[];
  sync: Awaited<ReturnType<typeof readHealth>>;
  canPublish: boolean;
  /** F87.1 · el evento se premia por su Pick'em legacy: Pick'ems 2.0 no puede activar recompensas aquí. */
  legacyAuthority: boolean;
  /** F87.1 · ¿la configuración guardada es exactamente la regla v1 aprobada? */
  rulesV1: boolean;
  /** F87.1 · qué falta para poder ACTIVAR recompensas (vacío = se puede, con confirmación). F87.2: = `launch.rewardedBlockers`. */
  activationBlockers: string[];
  /** F87.2 · preparación de lanzamiento canónica (puertas + bloqueos concretos). */
  launch: LaunchReadiness;
  /** F87.2 · elegibilidad para cobrar: política y recuento por código (sin datos personales). */
  eligibility: { policy: string | null; summary: Record<string, number> | null };
}

/** F87.2 · nodos para la puerta de lanzamiento (mismo cálculo de cierre que el detalle). */
function launchNodes(l: Loaded, now: number): LaunchNode[] {
  const isOpen = isOpenFn(l, now);
  return l.bracket.descriptor.nodes.map((n) => {
    const { input, node, real } = lockOf(l, n.matchId);
    const at = node ? effectiveLockAt(input) : null;
    return { matchId: n.matchId, points: n.points, lockAt: at === null ? null : new Date(at).toISOString(), start: real?.start_time ?? null, realStatus: real?.status ?? null, locked: l.bracket.status === "PUBLISHED" ? !isOpen(n.matchId) : false };
  });
}

/** F87.2 · LA preparación de lanzamiento de un ámbito con una configuración de recompensas dada (canónica). */
export async function readinessFor(sb: SupabaseClient, l: Loaded, rewards: BracketRewardConfig, now = Date.now()): Promise<LaunchReadiness> {
  const b = l.bracket;
  const scope = await realScope(sb, b.event_id, b.stage_ids);
  const res = deriveFormat({ eventId: b.event_id, kind: b.format_kind as PickemFormatKind, stages: scope.stages, matches: scope.matches, adminEdges: parseAdminEdges(b.admin_edges) ?? [] });
  const checksumNow = res.descriptor ? sha(canonicalDescriptor(res.descriptor)) : null;
  return launchReadiness({
    status: b.status, issues: validateFormat(b.descriptor, scope.matches), sourceDerivable: !!checksumNow,
    driftChanged: !!checksumNow && checksumNow !== b.descriptor_checksum, nodes: launchNodes(l, now),
    scoringVersion: b.scoring_version, maxPoints: b.max_points, rewards, rewardIssues: validateRewards(rewards, CATALOG), slug: b.slug,
    maxTierValue: rewards.tiers.length ? liabilityOf(rewards, CATALOG).maxTierValue : null,
    legacyAuthority: await hasLegacyAuthority(sb, b.event_id), now,
  });
}

/** F87.2 · recuento por código de elegibilidad (BD). Falla → `null` (el panel lo dice). */
async function eligibilitySummary(sb: SupabaseClient, bracketId: string): Promise<Record<string, number> | null> {
  const { data, error } = await sb.rpc("app_pickem_eligibility_summary", { p_bracket: bracketId });
  return error || !data || typeof data !== "object" ? null : (data as Record<string, number>);
}

export async function detailAdmin(sb: SupabaseClient, id: unknown, now = Date.now()): Promise<AdminResult<AdminDetail>> {
  if (!isUuid(id)) return fail(400, "Pick'em inválido");
  const l = await loadBracket(sb, id as string, { includeDraft: true });
  if (!l) return fail(404, "Pick'em no encontrado");
  const b = l.bracket;
  const adminEdges = parseAdminEdges(b.admin_edges) ?? [];
  const scope = await realScope(sb, b.event_id, b.stage_ids);
  const now_ = deriveFormat({ eventId: b.event_id, kind: b.format_kind as PickemFormatKind, stages: scope.stages, matches: scope.matches, adminEdges });
  const checksumNow = now_.descriptor ? sha(canonicalDescriptor(now_.descriptor)) : null;
  const issues = validateFormat(b.descriptor, scope.matches);
  // Deriva: lo congelado frente a lo que hoy dice la fuente.
  const frozenIds = new Set(b.descriptor.nodes.map((n) => n.matchId));
  const notes: string[] = [];
  for (const m of scope.matches) if (!frozenIds.has(m.id)) notes.push(`La fuente tiene un partido nuevo en el ámbito: ${m.id} (${m.round ?? "?"}).`);
  for (const n of b.descriptor.nodes) if (!scope.matches.some((m) => m.id === n.matchId)) notes.push(`El partido ${n.matchId} ya no está en la fuente.`);
  if (now_.descriptor) {
    const keyOf = (e: FormatEdge) => `${e.from}>${e.to}:${e.source}`;
    const frozenEdges = new Set(b.descriptor.edges.map(keyOf));
    const nowEdges = new Set(now_.descriptor.edges.map(keyOf));
    for (const k of nowEdges) if (!frozenEdges.has(k)) notes.push(`Arista nueva en la fuente: ${k}.`);
    for (const k of frozenEdges) if (!nowEdges.has(k)) notes.push(`Arista que la fuente ya no da: ${k}.`);
  }
  for (const i of issues) if (i.code === "SEED_CHANGED" || i.code === "RESULT_CONTRADICTS") notes.push(i.message);

  const { data: pk } = await sb.from("pickem_bracket_picks").select("user_id, match_id, team_id").eq("bracket_id", b.id).limit(50_000);
  const picks = (pk ?? []) as { user_id: string; match_id: string; team_id: string }[];
  const pickCount = new Map<string, number>();
  const byUser = new Map<string, Record<string, string>>();
  for (const p of picks) {
    pickCount.set(p.match_id, (pickCount.get(p.match_id) ?? 0) + 1);
    const u = byUser.get(p.user_id) ?? {}; u[p.match_id] = p.team_id; byUser.set(p.user_id, u);
  }
  const { data: es } = await sb.from("pickem_bracket_entries").select("user_id").eq("bracket_id", b.id);
  const entries = ((es ?? []) as { user_id: string }[]).map((e) => e.user_id);
  const ctx = contextOf(l);
  const isOpen = isOpenFn(l, now);
  // Picks que la deriva afecta: equipos que ya no juegan su partido en la fuente.
  let affected = 0;
  for (const p of picks) {
    const r = ctx.real.get(p.match_id);
    if (r?.teamA && r.teamB && p.team_id !== r.teamA.id && p.team_id !== r.teamB.id && !r.final) affected++;
  }
  const nodes: AdminNode[] = b.descriptor.nodes.map((n) => {
    const { input, node, real } = lockOf(l, n.matchId);
    const r = ctx.real.get(n.matchId);
    const at = node ? effectiveLockAt(input) : null;
    return {
      matchId: n.matchId, section: n.section, roundLabel: n.roundLabel, column: n.column, points: n.points,
      teamA: r?.teamA?.name ?? null, teamB: r?.teamB?.name ?? null, realStatus: real?.status ?? null, start: real?.start_time ?? null,
      lockAt: at === null ? null : new Date(at).toISOString(), locked: b.status === "PUBLISHED" ? !isOpen(n.matchId) : false,
      voided: !!node?.voided_at, voidReason: node?.void_reason ?? null, overridden: !!node?.lock_override_at,
      winner: r?.final ? (r.winnerId === r.teamA?.id ? r.teamA?.name : r.teamB?.name) ?? null : null, pickCount: pickCount.get(n.matchId) ?? 0,
    };
  });
  const rewards = parseRewards(b.rewards);
  const rewardIssues = validateRewards(rewards, CATALOG);
  // Distribución provisional (con la configuración actual) y completitud.
  const prov: Record<RewardTierId | "NONE", number> = { NONE: 0, PARTICIPATION: 0, GOOD: 0, GREAT: 0, ELITE: 0, PERFECT: 0 };
  const completion = { complete: 0, partial: 0, empty: 0 };
  for (const u of entries) {
    const s = scoreEntry(ctx, byUser.get(u) ?? {}, (mid) => !isOpen(mid));
    if (s.picked === 0) completion.empty++; else if (s.completion >= 1) completion.complete++; else completion.partial++;
    prov[tierFor(rewards, s) ?? "NONE"]++;
  }
  const economy = economyOf(b.descriptor, rewards, entries.length, entries.length ? prov : null, l, hasBlockingIssues(issues));
  const legacyAuthority = await hasLegacyAuthority(sb, b.event_id);
  const launch = launchReadiness({
    status: b.status, issues, sourceDerivable: !!checksumNow, driftChanged: !!checksumNow && checksumNow !== b.descriptor_checksum,
    nodes: launchNodes(l, now), scoringVersion: b.scoring_version, maxPoints: b.max_points, rewards, rewardIssues, slug: b.slug,
    maxTierValue: rewards.tiers.length ? economy.maxTierValue : null, legacyAuthority, now,
  });
  const eligibility = { policy: rewards.eligibilityPolicy ?? null, summary: entries.length ? await eligibilitySummary(sb, b.id) : {} };

  const { data: au } = await sb.from("content_audit_log").select("at, actor, action, detail").eq("entity_type", "pickem_bracket").eq("entity_id", b.id).order("at", { ascending: false }).limit(50);
  const actors = [...new Set(((au ?? []) as { actor: string | null }[]).map((a) => a.actor).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (actors.length) {
    const { data: ps } = await sb.from("profiles").select("id, username").in("id", actors);
    for (const p of (ps ?? []) as { id: string; username: string }[]) names.set(p.id, p.username);
  }
  const { descriptor, rewards: _r, ...rest } = b;
  return ok({
    bracket: { ...rest, formatLabel: FORMAT_LABEL[b.format_kind as PickemFormatKind] ?? b.format_kind },
    descriptor, issues,
    drift: { checksumNow, changed: !!checksumNow && checksumNow !== b.descriptor_checksum, notes, affectedPicks: affected },
    nodes, participants: entries.length, completion, rewards, rewardIssues, economy,
    audit: ((au ?? []) as { at: string; actor: string | null; action: string; detail: Record<string, unknown> }[]).map((a) => ({ at: a.at, action: a.action, actorName: a.actor ? names.get(a.actor) ?? null : null, detail: a.detail })),
    sync: await readHealth(sb),
    canPublish: b.status === "DRAFT" && !hasBlockingIssues(issues) && !!checksumNow && checksumNow === b.descriptor_checksum,
    legacyAuthority, rulesV1: isRewardRulesV1(rewards, b.slug),
    activationBlockers: launch.rewardedBlockers, launch, eligibility,
  });
}

/** F87.1 · condiciones para ACTIVAR recompensas (la BD las vuelve a exigir: reglas v1 y autoridad por evento). */
// F87.2 · resumen corto de las puertas de recompensa (mismas piezas que `launchReadiness`, la canónica).
export function activationBlockers(x: { status: string; legacyAuthority: boolean; issues: FormatIssue[]; rewards: BracketRewardConfig; slug: string; anyLocked: boolean }): string[] {
  return [
    ...timeBlockers(x.status, x.status === "PUBLISHED" && x.anyLocked),
    ...(x.legacyAuthority ? ["Este evento tiene un Pick'em clásico con recompensas propias (autoridad legacy): Pick'ems 2.0 no puede premiarlo."] : []),
    ...(hasBlockingIssues(x.issues) ? ["El cuadro no es válido (errores del validador)."] : []),
    ...rewardConfigBlockers(x.rewards, [], x.slug),
  ];
}

export function economyOf(d: FormatDescriptor, rewards: BracketRewardConfig, participants: number, provisional: Record<RewardTierId | "NONE", number> | null, l?: Loaded, incomplete = false): AdminEconomy {
  const liab = liabilityOf(rewards, CATALOG);
  const seeds = new Map<string, [{ id: string; name: string } | null, { id: string; name: string } | null]>();
  if (l) for (const n of d.nodes) { const r = contextOf(l).real.get(n.matchId); if (r) seeds.set(n.matchId, [r.teamA, r.teamB]); }
  // Con el cuadro incompleto (validador en rojo) el simulador no puede rellenar los huecos sin origen: no se simula.
  const simulation = rewards.tiers.length && !incomplete ? [0.5, 0.65, 0.8].map((p) => simulateTiers(d, rewards, CATALOG, p, { runs: 600, seed: 87, seeds })) : [];
  const warnings: string[] = [];
  if (incomplete && rewards.tiers.length) warnings.push("La simulación del valor esperado necesita el cuadro completo: corrige antes los errores del validador.");
  if (liab.maxTierValue > 35_000) warnings.push(`El escalón más caro vale ${liab.maxTierValue.toLocaleString("es-ES")} créditos equivalentes: por encima de un sobre Champions.`);
  if (rewards.tiers.some((t) => (t.reward.credits ?? 0) > 0)) warnings.push("Hay créditos en las recompensas: preferible sobres/coleccionables.");
  const informed = simulation.find((s) => s.accuracy === 0.65);
  if (informed && informed.ev > 15_000) warnings.push(`Valor esperado alto para un aficionado informado (${Math.round(informed.ev).toLocaleString("es-ES")} por evento).`);
  const provisionalValue = provisional ? rewards.tiers.reduce((s, t) => s + (provisional[t.id] ?? 0) * tierValue(t.reward, CATALOG), 0) : null;
  return {
    participants, perTier: liab.perTier.map((t) => ({ id: t.id, label: TIER_LABEL[t.id], value: t.value })), maxTierValue: liab.maxTierValue,
    worstCaseParticipants: liab.worstCase(Math.max(participants, 0)), worstCase1000: liab.worstCase(1000),
    provisional, provisionalValue, simulation, warnings,
  };
}

/* ═══════════════════════════════ ACCIONES ═══════════════════════════════ */

const RPC_ERRORS: Record<string, [number, string]> = {
  NOT_ADMIN: [403, "Solo un administrador puede hacer esto"],
  PICKEM_NOT_FOUND: [404, "Pick'em no encontrado"],
  PICKEM_STALE_OR_FROZEN: [409, "Otro administrador cambió este borrador (o ya no es borrador). Recarga."],
  PICKEM_STALE: [409, "Otro administrador cambió este Pick'em. Recarga y revisa."],
  PICKEM_BAD_STATE: [409, "Esa acción no está permitida en el estado actual"],
  PICKEM_CHECKSUM: [409, "Lo que intentas publicar no es lo guardado. Recarga."],
  PICKEM_MATCH_MISSING: [409, "Algún partido del cuadro ya no existe o no tiene hora: refresca el borrador"],
  PICKEM_HAS_ENTRIES: [409, "Ya hay jugadores: no se despublica (se cancela con motivo)"],
  PICKEM_REASON_REQUIRED: [400, "El motivo es obligatorio (mínimo 8 caracteres)"],
  PICKEM_BAD_ACTION: [400, "Acción inválida"],
  PICKEM_BAD_TIME: [400, "La nueva hora de cierre debe ser futura"],
  PICKEM_MATCH_STARTED: [409, "El partido real ya empezó o tiene resultado: no se reabre"],
  PICKEM_BAD_MATCH: [400, "Ese partido no es de este Pick'em"],
  PICKEM_BAD_REWARDS_STATUS: [400, "Estado de recompensas inválido"],
  PICKEM_ACTIVATION_REQUIRES_ACK: [400, "Activar exige aceptar el pasivo máximo y al menos un escalón"],
  PICKEM_REWARDS_FROZEN: [409, "Las recompensas ya están congeladas (alguna predicción cerró o el Pick'em terminó)"],
  PICKEM_FROZEN: [409, "El formato y la puntuación se congelaron al publicar"],
  PICKEM_BAD_TRANSITION: [409, "Ese cambio de estado no está permitido"],
  PICKEM_NOT_DECIDED: [409, "Hay partidos puntuables sin resultado definitivo (o anúlalos con motivo)"],
  PICKEM_NOT_STABLE: [409, "Espera 12 h desde el último partido antes de liquidar (correcciones de la fuente)"],
  PICKEM_NOTHING_TO_SCORE: [409, "No hay partidos puntuables"],
  PICKEM_LEGACY_AUTHORITY: [409, "Este evento se premia por su Pick'em clásico: Pick'ems 2.0 no puede activar recompensas aquí"],
  PICKEM_ELIGIBILITY_POLICY_REQUIRED: [409, "Activar exige la política de elegibilidad para cobrar (reward-eligibility-v1)"],
  PICKEM_REWARDS_TOO_LATE: [409, "Demasiado tarde: el primer cierre ya pasó o un partido ya empezó"],
  PICKEM_RULES_NOT_APPROVED: [409, "Solo se activan las reglas v1 aprobadas, sin variaciones"],
  "duplicate key": [409, "Ese slug ya existe"],
  pickem_brackets_slug_key: [409, "Ese slug ya existe"],
};
function rpcFail(message: string | undefined): AdminResult<never> {
  const m = message ?? "";
  const hit = Object.keys(RPC_ERRORS).find((k) => m.includes(k));
  if (hit) { const [s, t] = RPC_ERRORS[hit]; return fail(s, t); }
  console.error(`[admin/pickems] rpc: ${m}`);
  return fail(500, "No se pudo completar la operación");
}

export interface DraftInput { eventId?: unknown; stageIds?: unknown; kind?: unknown; slug?: unknown; title?: unknown; adminEdges?: unknown; lockPolicy?: unknown }

async function deriveFromInput(sb: SupabaseClient, f: DraftInput) {
  const eventId = typeof f.eventId === "string" && f.eventId.length <= 80 ? f.eventId : null;
  const stageIds = Array.isArray(f.stageIds) && f.stageIds.length >= 1 && f.stageIds.length <= 4 && f.stageIds.every((s) => isUuid(s)) ? (f.stageIds as string[]) : null;
  if (!eventId || !stageIds) return { error: "Evento y fases (1–4) obligatorios" } as const;
  const kind = f.kind === undefined || f.kind === null ? null : SUPPORTED_FORMATS.includes(f.kind as PickemFormatKind) ? (f.kind as PickemFormatKind) : undefined;
  if (kind === undefined) return { error: "Formato no soportado" } as const;
  const adminEdges = parseAdminEdges(f.adminEdges);
  if (!adminEdges) return { error: "Aristas de admin inválidas" } as const;
  const scope = await realScope(sb, eventId, stageIds);
  if (scope.stages.length !== stageIds.length) return { error: "Alguna fase no es de ese evento" } as const;
  const res = deriveFormat({ eventId, kind, stages: scope.stages, matches: scope.matches, adminEdges });
  return { eventId, stageIds, adminEdges, res, scope } as const;
}

export async function previewDraft(sb: SupabaseClient, f: DraftInput): Promise<AdminResult<{ descriptor: FormatDescriptor | null; issues: FormatIssue[]; detected: string | null; checksum: string | null; canPublish: boolean }>> {
  const d = await deriveFromInput(sb, f);
  if ("error" in d) return fail(400, d.error!);
  const desc = d.res.descriptor;
  return ok({ descriptor: desc, issues: d.res.issues, detected: d.res.detected, checksum: desc ? sha(canonicalDescriptor(desc)) : null, canPublish: !!desc && !hasBlockingIssues(d.res.issues) });
}

export async function saveDraft(sb: SupabaseClient, actor: string, id: unknown, version: unknown, f: DraftInput): Promise<AdminResult<{ id: string; version: number; issues: FormatIssue[] }>> {
  const d = await deriveFromInput(sb, f);
  if ("error" in d) return fail(400, d.error!);
  const desc = d.res.descriptor;
  if (!desc) return fail(409, d.res.issues[0]?.message ?? "No se puede derivar el formato");
  const slug = typeof f.slug === "string" && SLUG.test(f.slug) && f.slug.length >= 3 && f.slug.length <= 64 ? f.slug : null;
  const title = typeof f.title === "string" && f.title.trim().length >= 3 && f.title.trim().length <= 80 ? f.title.trim() : null;
  if (!slug || !title) return fail(400, "Slug (a-z, 0-9, guiones) y título (3–80) obligatorios");
  const lockPolicy = f.lockPolicy === "STAGE" ? "STAGE" : "MATCH";
  const isNew = id === null || id === undefined;
  if (!isNew && (!isUuid(id) || !Number.isInteger(version))) return fail(400, "Borrador inválido");
  const { data, error } = await sb.rpc("app_pickem_admin_save_draft", {
    p_actor: actor, p_id: isNew ? null : id, p_slug: slug, p_event: d.eventId, p_title: title, p_kind: desc.kind, p_stage_ids: d.stageIds,
    p_descriptor: desc, p_checksum: sha(canonicalDescriptor(desc)), p_admin_edges: d.adminEdges,
    p_max_points: desc.nodes.reduce((s, n) => s + n.points, 0), p_lock_policy: lockPolicy, p_expected_version: isNew ? null : version,
  });
  if (error) return rpcFail(error.message);
  const r = data as { id: string; version: number };
  return ok({ id: r.id, version: r.version, issues: d.res.issues });
}

/** Re-deriva un borrador con lo que hoy dice la fuente (y sus aristas de admin). */
export async function refreshDraft(sb: SupabaseClient, actor: string, id: unknown, version: unknown): Promise<AdminResult<{ id: string; version: number; issues: FormatIssue[] }>> {
  if (!isUuid(id)) return fail(400, "Pick'em inválido");
  const l = await loadBracket(sb, id as string, { includeDraft: true });
  if (!l) return fail(404, "Pick'em no encontrado");
  if (l.bracket.status !== "DRAFT") return fail(409, "Solo se refresca un borrador");
  return saveDraft(sb, actor, id, version, { eventId: l.bracket.event_id, stageIds: l.bracket.stage_ids, kind: l.bracket.format_kind, slug: l.bracket.slug, title: l.bracket.title, adminEdges: l.bracket.admin_edges, lockPolicy: l.bracket.lock_policy });
}

export async function publish(sb: SupabaseClient, actor: string, id: unknown, version: unknown): Promise<AdminResult<{ id: string; status: string }>> {
  if (!isUuid(id) || !Number.isInteger(version)) return fail(400, "Pick'em inválido");
  const l = await loadBracket(sb, id as string, { includeDraft: true });
  if (!l) return fail(404, "Pick'em no encontrado");
  const b = l.bracket;
  if (b.status !== "DRAFT") return fail(409, "Solo se publica un borrador");
  const scope = await realScope(sb, b.event_id, b.stage_ids);
  const res = deriveFormat({ eventId: b.event_id, kind: b.format_kind as PickemFormatKind, stages: scope.stages, matches: scope.matches, adminEdges: parseAdminEdges(b.admin_edges) ?? [] });
  if (!res.descriptor) return fail(409, "La fuente ya no permite derivar este formato");
  if (sha(canonicalDescriptor(res.descriptor)) !== b.descriptor_checksum) return fail(409, "La fuente cambió desde que guardaste el borrador: pulsa «Refrescar» y revísalo antes de publicar");
  const issues = validateFormat(b.descriptor, scope.matches);
  if (hasBlockingIssues(issues)) return fail(409, `El validador lo bloquea: ${issues.filter((i) => i.severity === "ERROR").slice(0, 3).map((i) => i.message).join(" · ")}`);
  // F87.2 · la preparación canónica: publicar exige estructura/fuente/cierres/puntuación; con recompensas ACTIVAS, todo.
  const ready = await readinessFor(sb, l, parseRewards(b.rewards));
  const blockers = b.rewards_status === "ACTIVE" ? ready.rewardedBlockers : ready.publishBlockers;
  if (blockers.length) return fail(409, `No está listo para publicar${b.rewards_status === "ACTIVE" ? " con recompensas" : ""}: ${blockers.slice(0, 4).join(" · ")}`);
  const { data, error } = await sb.rpc("app_pickem_admin_set_status", { p_actor: actor, p_id: id, p_action: "publish", p_expected_version: version, p_checksum: b.descriptor_checksum, p_reason: null });
  if (error) return rpcFail(error.message);
  return ok(data as { id: string; status: string });
}

export async function setStatus(sb: SupabaseClient, actor: string, id: unknown, version: unknown, action: "unpublish" | "cancel" | "delete", reason: unknown): Promise<AdminResult<unknown>> {
  if (!isUuid(id) || !Number.isInteger(version)) return fail(400, "Pick'em inválido");
  const why = typeof reason === "string" ? reason.trim().slice(0, 300) : null;
  const { data, error } = await sb.rpc("app_pickem_admin_set_status", { p_actor: actor, p_id: id, p_action: action, p_expected_version: version, p_checksum: null, p_reason: why });
  if (error) return rpcFail(error.message);
  return ok(data);
}

export async function setRewards(sb: SupabaseClient, actor: string, id: unknown, rewardsVersion: unknown, raw: unknown, status: unknown, ack: unknown): Promise<AdminResult<{ rewardsVersion: number; rewardsStatus: string; issues: RewardIssue[] }>> {
  if (!isUuid(id) || !Number.isInteger(rewardsVersion)) return fail(400, "Pick'em inválido");
  if (status !== "OFF" && status !== "DRAFT" && status !== "ACTIVE") return fail(400, "Estado de recompensas inválido");
  const cfg = parseRewards({ ...(raw && typeof raw === "object" ? raw : {}), status });
  const issues = validateRewards(cfg, CATALOG);
  if (status !== "OFF" && hasRewardErrors(issues)) return fail(400, `Recompensas inválidas: ${issues.filter((i) => i.severity === "ERROR").slice(0, 3).map((i) => i.message).join(" · ")}`);
  if (status === "ACTIVE") {
    // F87.1 · activar es una decisión aparte y explícita: reglas v1 exactas, cuadro válido, sin autoridad legacy, confirmación.
    if (ack !== true) return fail(400, "Activar exige confirmar el pasivo máximo y las reglas");
    const l = await loadBracket(sb, id as string, { includeDraft: true });
    if (!l) return fail(404, "Pick'em no encontrado");
    // F87.2 · la preparación canónica completa: estructura, fuente, cierres, puntuación, recompensas (con política de
    // elegibilidad), economía, colisión legacy y tiempo. La BD vuelve a exigir lo económico (0072/0073).
    const blockers = (await readinessFor(sb, l, cfg)).rewardedBlockers;
    if (blockers.length) return fail(409, `No se pueden activar: ${blockers.join(" · ")}`);
  }
  const { data, error } = await sb.rpc("app_pickem_admin_set_rewards", {
    p_actor: actor, p_id: id, p_rewards: cfg, p_status: status, p_checksum: sha(canonicalRewards(cfg)), p_expected_rewards_version: rewardsVersion, p_ack_liability: ack === true,
  });
  if (error) return rpcFail(error.message);
  const r = data as { rewardsVersion: number; rewardsStatus: string };
  return ok({ ...r, issues });
}
const hasRewardErrors = (i: RewardIssue[]) => i.some((x) => x.severity === "ERROR");

export async function matchAction(sb: SupabaseClient, actor: string, id: unknown, matchId: unknown, action: unknown, until: unknown, reason: unknown): Promise<AdminResult<unknown>> {
  if (!isUuid(id) || typeof matchId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(matchId)) return fail(400, "Partido inválido");
  if (action !== "lock_now" && action !== "reschedule" && action !== "void" && action !== "unvoid") return fail(400, "Acción inválida");
  const at = typeof until === "string" && Number.isFinite(Date.parse(until)) ? new Date(until).toISOString() : null;
  if (action === "reschedule" && !at) return fail(400, "Falta la nueva hora de cierre");
  const { data, error } = await sb.rpc("app_pickem_admin_match", { p_actor: actor, p_id: id, p_match: matchId, p_action: action, p_until: at, p_reason: typeof reason === "string" ? reason.trim().slice(0, 300) : null });
  if (error) return rpcFail(error.message);
  return ok(data);
}

export async function settle(sb: SupabaseClient, actor: string, id: unknown, settlementVersion: unknown, reason: unknown): Promise<AdminResult<unknown>> {
  if (!isUuid(id) || !Number.isInteger(settlementVersion)) return fail(400, "Pick'em inválido");
  const l = await loadBracket(sb, id as string);
  if (!l) return fail(404, "Pick'em no encontrado");
  // Estructura final consistente: ningún resultado real contradice el grafo congelado.
  const issues = validateFormat(l.bracket.descriptor, l.matches).filter((i) => i.code === "RESULT_CONTRADICTS" || i.code === "MATCH_MISSING");
  if (issues.length) return fail(409, `La estructura real contradice el cuadro: ${issues.slice(0, 3).map((i) => i.message).join(" · ")}. Anula (VOID) con motivo lo afectado o cancela.`);
  const { data, error } = await sb.rpc("app_pickem_admin_settle", { p_actor: actor, p_id: id, p_expected_settlement: settlementVersion, p_reason: typeof reason === "string" ? reason.trim().slice(0, 300) : null });
  if (error) return rpcFail(error.message);
  return ok(data);
}

/* ═══════════════════════════════ HTTP ═══════════════════════════════ */

type H = (req: Request) => Promise<NextResponse>;
const BODY_KEYS = ["action", "id", "version", "rewardsVersion", "settlementVersion", "fields", "rewards", "rewardsStatus", "ack", "matchId", "matchAction", "until", "reason"] as const;
const FIELD_KEYS = ["eventId", "stageIds", "kind", "slug", "title", "adminEdges", "lockPolicy"];

export function pickemsAdminHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => {
      const id = new URL(req.url).searchParams.get("id");
      return id !== null ? respond(await detailAdmin(sb, id)) : respond(await listAdmin(sb));
    }),
    POST: (req) => runAdmin(req, deps, "admin_write", async ({ sb, userId }) => {
      const r = await readBody(req, BODY_KEYS);
      if (!r.ok) return r.res;
      const b = r.body;
      if (b.fields !== undefined) {
        if (!b.fields || typeof b.fields !== "object" || Array.isArray(b.fields)) return json({ error: "Campos inválidos" }, 400);
        const extra = Object.keys(b.fields).find((k) => !FIELD_KEYS.includes(k));
        if (extra) return json({ error: `Campo no permitido: ${extra.slice(0, 40)}` }, 400);
      }
      const f = (b.fields ?? {}) as DraftInput;
      switch (b.action) {
        case "preview": return respond(await previewDraft(sb, f));
        case "create": return respond(await saveDraft(sb, userId, null, null, f));
        case "update": return respond(await saveDraft(sb, userId, b.id, b.version, f));
        case "refresh": return respond(await refreshDraft(sb, userId, b.id, b.version));
        case "publish": return respond(await publish(sb, userId, b.id, b.version));
        case "unpublish": case "cancel": case "delete": return respond(await setStatus(sb, userId, b.id, b.version, b.action, b.reason));
        case "proposeRewards": {
          if (!isUuid(b.id)) return json({ error: "Pick'em inválido" }, 400);
          const { data } = await sb.from("pickem_brackets").select("slug").eq("id", b.id).maybeSingle();
          const slug = (data as { slug: string } | null)?.slug;
          return slug ? respond(ok({ rewards: rewardRulesV1(slug, "DRAFT") })) : json({ error: "Pick'em no encontrado" }, 404);
        }
        case "rewards": return respond(await setRewards(sb, userId, b.id, b.rewardsVersion, b.rewards, b.rewardsStatus, b.ack));
        case "match": return respond(await matchAction(sb, userId, b.id, b.matchId, b.matchAction, b.until, b.reason));
        case "settle": return respond(await settle(sb, userId, b.id, b.settlementVersion, b.reason));
        default: return json({ error: "Acción desconocida" }, 400);
      }
    }),
  };
}
