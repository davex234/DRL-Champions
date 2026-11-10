/**
 * F73 · MOTOR DE MISIONES (servidor) — eventos → progreso, estado del jugador, reclamos. SERVER-AUTHORITATIVE.
 *
 *   · Los EVENTOS los produce el servidor en sus propios puntos de verdad: fin de partida ya persistido (PvE
 *     `commitDecision`, PvP tras la escritura condicionada), apertura de sobre ya aplicada, crafteo ya aplicado.
 *     El cliente no puede mandar ni progreso ni eventos.
 *   · Cada evento tiene clave única por usuario (`match:<id>`, la ref de la operación). `app_mission_apply` la registra
 *     y aplica las operaciones en UNA transacción: repetir el evento no hace nada.
 *   · El progreso lo calcula el motor puro (`domain/missionEngine`) sobre las misiones ACTIVE del jugador; la base de
 *     datos solo suma/reinicia con tope y marca completadas.
 *   · Reclamar: la recompensa sale por `award()` → `app_grant_reward`, idempotente por clave (`m73:mission:<id>`,
 *     `m73:project:<id>`): diez reclamos simultáneos dan UNA recompensa.
 *   · Nada de esto rompe una partida: los enganches capturan sus errores y lo registran.
 *   · F83 · los MISMOS enganches alimentan la XP y los retos de la temporada activa (`ingestSeasonEvent`): un único punto
 *     de entrada por evento canónico (`match:<id>`, la ref del crafteo), idempotente también en la temporada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog, serverCatalogSync } from "@/server/catalog";
import { canonicalCardTeam } from "@/data/teamIdentities";
import { award } from "./rewards";
import { projectForgeGate } from "./forge";
import { logForge } from "./forgeConfig";
import { loadF73Config, logF73 } from "./f73Config";
import { evaluateAll, matchCounts } from "@/domain/missionEngine/evaluate";
import { activeForProgress, hasReward, missionStates, projectStates, type MissionView, type ProjectView } from "@/domain/missionEngine/state";
import type { DeckFact, MatchEvent, MissionEvent, MissionProgressRow } from "@/domain/missionEngine/types";
import { timeoutsOf } from "@/lib/duel/turnClock";
import type { DuelMatch, Side } from "@/domain/cardgame/match";
import { ingestSeasonEvent } from "./seasonTrack";

export interface ServiceOut<T> { ok: boolean; status: number; error?: string; code?: string; data?: T }
const fail = <T>(status: number, error: string, code?: string): ServiceOut<T> => ({ ok: false, status, error, code });
const done = <T>(data: T): ServiceOut<T> => ({ ok: true, status: 200, data });

async function progressRows(sb: SupabaseClient, userId: string): Promise<MissionProgressRow[]> {
  const { data, error } = await sb.from("user_mission_progress").select("mission_id, progress, completed_at, claimed_at").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { mission_id: string; progress: number; completed_at: string | null; claimed_at: string | null }[]).map((r) => ({
    missionId: r.mission_id, progress: Number(r.progress), completedAt: r.completed_at ? Date.parse(r.completed_at) : null, claimedAt: r.claimed_at ? Date.parse(r.claimed_at) : null,
  }));
}

/* ═══════════════════════════ EVENTOS ═══════════════════════════ */

/**
 * Aplica UN evento a UN usuario. Registra el evento aunque no afecte a ninguna misión (una partida se procesa una vez:
 * activar una misión después no cuenta partidas antiguas). Devuelve las misiones completadas por este evento.
 */
export async function ingestEvent(sb: SupabaseClient, userId: string, event: MissionEvent): Promise<{ applied: boolean; completed: string[] }> {
  const cfg = await loadF73Config(sb);
  if (!cfg.available) return { applied: false, completed: [] };
  const now = Date.now();
  const rows = await progressRows(sb, userId);
  const ops = evaluateAll(activeForProgress(cfg.missions, rows, now), event);
  const evidence = event.kind === "MATCH"
    ? { mode: event.mode, won: event.won, draw: event.draw, finished: event.finished, human: event.humanDecisions, auto: event.autoDecisions, counts: matchCounts(event), missions: ops.map((o) => o.missionId) }
    : { ...("packId" in event ? { packId: event.packId } : { recipeId: event.recipeId }), missions: ops.map((o) => o.missionId) };
  const { data, error } = await sb.rpc("app_mission_apply", {
    p_user: userId, p_event_key: event.key, p_kind: event.kind,
    p_ops: ops.map((o) => ({ mission: o.missionId, op: o.op, value: o.op === "INC" ? o.value : 0, target: o.target })),
    p_evidence: evidence,
  });
  if (error) { logF73("error", "mission_event_failed", { kind: event.kind, key: event.key, code: error.code ?? null }); return { applied: false, completed: [] }; }
  const res = (data ?? {}) as { repeated?: boolean; completed?: string[] };
  if (res.repeated) logF73("info", "mission_event_duplicate", { kind: event.kind, key: event.key });
  else if (event.kind === "MATCH" && !matchCounts(event)) logF73("info", "mission_event_rejected", { key: event.key, reason: event.mode === "PRIVATE" ? "private" : !event.finished ? "not_finished" : "afk", human: event.humanDecisions });
  return { applied: !res.repeated, completed: res.completed ?? [] };
}

/** Hechos de la partida para UN bando, desde el estado que congeló y guardó el servidor. */
export function matchEventFor(m: DuelMatch, side: Side, info: { matchId: string; mode: MatchEvent["mode"]; difficulty: MatchEvent["difficulty"]; finished: boolean }): MatchEvent {
  const reg = serverCatalogSync().registry;
  const snap = side === "A" ? m.snapshotA : m.snapshotB;
  const deck: DeckFact[] = snap.cards.map((c) => {
    const def = reg.card(c.cardId);
    const player = reg.player(c.playerId);
    return { cardId: c.cardId, playerId: c.playerId, team: canonicalCardTeam(def ?? { team: c.team }, player).key, country: player?.country ?? "", role: c.role };
  });
  const auto = timeoutsOf(m).filter((t) => t.side === side).length;
  const decisions = m.turns.length; // una decisión propia por turno (atacar o defender)
  return {
    kind: "MATCH", key: `match:${info.matchId}`, mode: info.mode, difficulty: info.difficulty,
    won: m.result?.winner === side, draw: !!m.result?.isDraw, finished: info.finished,
    turnsWon: m.turns.filter((t) => t.outcome === side).length,
    humanDecisions: Math.max(0, decisions - auto), autoDecisions: auto, deck,
  };
}

/** Enganche de fin de partida. NUNCA lanza: una misión no puede romper una partida. */
export async function settleMissionsForMatch(
  sb: SupabaseClient, matchId: string, m: DuelMatch, players: { userId: string; side: Side }[],
  info: { mode: MatchEvent["mode"]; difficulty: MatchEvent["difficulty"]; finished: boolean },
): Promise<void> {
  if (m.status === "IN_PROGRESS" || m.status === "WAITING") return;
  try {
    await serverCatalog(sb);
    for (const p of players) {
      if (!p.userId) continue;
      const event = matchEventFor(m, p.side, { matchId, ...info });
      await ingestEvent(sb, p.userId, event);
      await ingestSeasonEvent(sb, p.userId, event); // F83 · nunca lanza
    }
  } catch (e) {
    logF73("error", "mission_match_hook_failed", { matchId, error: (e as Error).message.slice(0, 200) });
  }
}

/** Enganche genérico (apertura, crafteo). NUNCA lanza. */
export async function settleMissionsForOp(sb: SupabaseClient, userId: string, event: MissionEvent): Promise<void> {
  try { await ingestEvent(sb, userId, event); } catch (e) { logF73("error", "mission_op_hook_failed", { kind: event.kind, error: (e as Error).message.slice(0, 200) }); }
  await ingestSeasonEvent(sb, userId, event); // F83 · nunca lanza (apertura de sobre: sin XP de temporada)
}

/* ═══════════════════════════ ESTADO ═══════════════════════════ */

export interface MissionsSnapshot {
  available: boolean;
  reason: string;
  serverNow: number;
  missions: MissionView[];
  projects: ProjectView[];
}

export async function getMissionsState(sb: SupabaseClient, userId: string): Promise<ServiceOut<MissionsSnapshot>> {
  const cfg = await loadF73Config(sb);
  const now = Date.now();
  if (!cfg.available) return done({ available: false, reason: cfg.reason, serverNow: now, missions: [], projects: [] });
  const [rows, claims] = await Promise.all([
    progressRows(sb, userId),
    sb.from("user_project_claims").select("project_id").eq("user_id", userId),
  ]);
  if (claims.error) return fail(500, claims.error.message);
  const views = missionStates(cfg.missions, rows, now);
  const claimed = new Set(((claims.data ?? []) as { project_id: string }[]).map((c) => c.project_id));
  return done({ available: true, reason: "OK", serverNow: now, missions: views, projects: projectStates(cfg.projects, views, claimed, now) });
}

/* ═══════════════════════════ RECLAMOS ═══════════════════════════ */

export async function claimMission(sb: SupabaseClient, userId: string, missionId: string): Promise<ServiceOut<{ repeated: boolean; snapshot: MissionsSnapshot }>> {
  const cfg = await loadF73Config(sb);
  if (!cfg.available) return fail(503, "Las misiones aún no están disponibles", "MIGRATION_PENDING");
  const m = cfg.missions.find((x) => x.id === missionId && x.status === "ACTIVE");
  if (!m) return fail(404, "Misión no encontrada", "MISSION_NOT_FOUND");
  if (!hasReward(m)) return fail(409, "Esta misión no tiene recompensa que reclamar", "NO_REWARD");
  const { data: row, error } = await sb.from("user_mission_progress").select("completed_at, claimed_at").eq("user_id", userId).eq("mission_id", missionId).maybeSingle();
  if (error) return fail(500, error.message);
  const r = row as { completed_at: string | null; claimed_at: string | null } | null;
  if (!r || !r.completed_at) return fail(409, "La misión todavía no está completada", "NOT_COMPLETED");
  let repeated = !!r.claimed_at;
  if (!repeated) {
    // Paga primero (idempotente por clave: una sola recompensa aunque lleguen diez reclamos) y marca después.
    const out = await award(sb, {
      userId, ref: `m73:mission:${missionId}`, reason: `mission_reward: ${m.name}`,
      reward: { credits: m.reward.credits ?? 0, xp: m.reward.xp ?? 0, ...(m.reward.packId && (m.reward.packCount ?? 0) > 0 ? { packId: m.reward.packId, packCount: m.reward.packCount } : {}) },
    });
    if (!out.applied) repeated = true;
    await sb.from("user_mission_progress").update({ claimed_at: new Date().toISOString() })
      .eq("user_id", userId).eq("mission_id", missionId).is("claimed_at", null);
    if (repeated) logF73("info", "claim_duplicate", { kind: "mission", missionId });
  }
  const snap = await getMissionsState(sb, userId);
  return done({ repeated, snapshot: snap.data! });
}

export async function claimProject(sb: SupabaseClient, userId: string, projectId: string): Promise<ServiceOut<{ repeated: boolean; cardId: string; cardUid: string | null; snapshot: MissionsSnapshot }>> {
  const cfg = await loadF73Config(sb);
  if (!cfg.available) return fail(503, "Los proyectos aún no están disponibles", "MIGRATION_PENDING");
  await serverCatalog(sb);
  const p = cfg.projects.find((x) => x.id === projectId && x.status === "ACTIVE");
  if (!p) return fail(404, "Proyecto no encontrado", "PROJECT_NOT_FOUND");
  if (!serverCatalogSync().registry.card(p.targetCardId)) { logF73("error", "invalid_project", { projectId }); return fail(409, "La carta de este proyecto no existe", "INVALID_PROJECT"); }
  const prior = await sb.from("user_project_claims").select("card_uid").eq("user_id", userId).eq("project_id", projectId).maybeSingle();
  if (prior.error) return fail(500, prior.error.message);
  if (prior.data) {
    logF73("info", "claim_duplicate", { kind: "project", projectId });
    const snap = await getMissionsState(sb, userId);
    return done({ repeated: true, cardId: p.targetCardId, cardUid: (prior.data as { card_uid: string | null }).card_uid, snapshot: snap.data! });
  }
  const state = await getMissionsState(sb, userId);
  const view = state.data?.projects.find((x) => x.id === projectId);
  if (!view || view.state === "LOCKED") return fail(409, "Este proyecto no está disponible ahora", "PROJECT_LOCKED");
  if (view.state !== "COMPLETED" && view.state !== "CLAIMED") return fail(409, "Completa todas las misiones del proyecto", "NOT_COMPLETED");
  // F79 · Proyectos 2.0: si la Forja le añadió etapas (reunir / fabricar), el servidor las exige ANTES de pagar.
  const gate = await projectForgeGate(sb, userId, projectId);
  if (!gate.ok) return fail(409, gate.message, "PROJECT_REQUIREMENTS");
  const out = await award(sb, { userId, ref: `m73:project:${projectId}`, reason: `project_reward: ${p.name}`, reward: { cardId: p.targetCardId } });
  const cardUid = out.cardUids?.[0] ?? null;
  await sb.from("user_project_claims").insert({ user_id: userId, project_id: projectId, card_uid: cardUid });
  if (out.applied) logForge("info", "project_complete", { projectId });
  const snap = await getMissionsState(sb, userId);
  return done({ repeated: !out.applied, cardId: p.targetCardId, cardUid, snapshot: snap.data! });
}
