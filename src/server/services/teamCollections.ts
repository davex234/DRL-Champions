/**
 * COLECCIONES POR EQUIPO E INSIGNIAS REGIONALES — SERVIDOR (jugador).
 *
 *   · Los equipos y sus cartas salen del catálogo PUBLICADO del servidor (`serverCatalog`: lo que el panel de
 *     administración tiene publicado en `content_cards`), agrupado por el equipo impreso. Una carta retirada ya no se
 *     puede conseguir y no se exige. Nada de esto está escrito a mano.
 *   · Lo que tiene el jugador sale del RESUMEN POR CARTA (`loadCollectionSummary`, migración 0074): una consulta cuyo
 *     tamaño lo acota el catálogo, no la colección. Aquí no se recorre el inventario ni se envía al cliente.
 *   · LEER no escribe nada. Lo que debe durar —la primera compleción de un equipo (300 XP de temporada, una vez) y las
 *     insignias regionales— lo guarda `settleTeamCollections` con UNA llamada a `app_team_collections_settle` (0075):
 *     la base vuelve a comprobar las cartas en la misma transacción, así que el cliente no decide nada y dos
 *     peticiones a la vez no duplican ni XP ni insignias.
 *   · Sin 0075 (código desplegado antes que la migración) todo lo derivado sigue funcionando; simplemente no se guarda
 *     ni se concede nada todavía.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog } from "@/server/catalog";
import {
  buildTeamCollections, settlePlan, teamCollectionsView, teamDetail, NOTHING_PERSISTED, TEAM_COLLECTION_XP,
  type Persisted, type TeamCollectionsModel, type TeamCollectionsView, type TeamDetailView,
} from "@/domain/teamCollections/model";
import { phaseOf } from "@/domain/seasonTrack/types";
import type { Region } from "@/domain/cards/types";
import { isMissingRelation } from "./f73Config";
import { publishedSeasons } from "./seasonTrack";
import { loadCollectionSummary, ownedCardIdsOf, countsOf } from "./userCards";

export type { TeamCollectionsView, TeamDetailView };

export interface TeamCollectionsResult<T> { ok: boolean; status: number; error?: string; code?: string; data?: T }
const ok = <T,>(data: T): TeamCollectionsResult<T> => ({ ok: true, status: 200, data });
const fail = (status: number, code: string, error: string): TeamCollectionsResult<never> => ({ ok: false, status, code, error });

/** Clave de equipo: la canónica (`team-heretics`) o `raw:<texto impreso>`. Cerrada para no aceptar cualquier cosa. */
export const TEAM_ID_PATTERN = /^(?:[a-z0-9][a-z0-9-]{0,47}|raw:[^\u0000-\u001f]{1,48})$/;

let warned = "";
/** El modelo vigente: equipos y cartas del catálogo publicado. Lo usan el jugador y el panel de administración. */
export async function teamCollectionsModel(sb: SupabaseClient): Promise<TeamCollectionsModel> {
  const cat = await serverCatalog(sb);
  const model = buildTeamCollections({ cards: cat.cards.filter((c) => cat.lifecycleOf(c.id) === "PUBLISHED"), player: (id) => cat.player(id) });
  // Falta de región o de equipo: se avisa una vez por cambio, no en cada petición.
  const gaps = model.unassigned.length || model.teamless.length ? JSON.stringify({ unassigned: model.unassigned.map((t) => t.id), teamless: model.teamless.length }) : "";
  if (gaps !== warned) { warned = gaps; if (gaps) console.warn("[team-collections]", gaps); }
  return model;
}

// ───────────────────────────── Lo guardado (0075) ─────────────────────────────

interface Stored extends Persisted { /** Las tablas de 0075 existen. */ available: boolean }

async function readPersisted(sb: SupabaseClient, userId: string): Promise<Stored> {
  const [teams, regions] = await Promise.all([
    sb.from("user_team_completions").select("team_id, completed_at, xp_amount, xp_granted_at").eq("user_id", userId),
    sb.from("user_region_badges").select("region, unlocked_at").eq("user_id", userId),
  ]);
  for (const r of [teams, regions]) {
    if (!r.error) continue;
    if (isMissingRelation(r.error)) return { ...NOTHING_PERSISTED, available: false };
    throw new Error(r.error.message);
  }
  return {
    available: true,
    teams: new Map(((teams.data ?? []) as { team_id: string; completed_at: string; xp_amount: number | null; xp_granted_at: string | null }[])
      .map((r) => [r.team_id, { completedAt: r.completed_at, xpGranted: r.xp_granted_at !== null, xpAmount: r.xp_amount ?? 0 }])),
    regions: new Map(((regions.data ?? []) as { region: string; unlocked_at: string }[]).map((r) => [r.region, r.unlocked_at])),
  };
}

/** La temporada donde se cobran los XP: la PUBLICADA y en fechas. Sin 0064 o sin temporada activa, null. */
async function activeSeasonId(sb: SupabaseClient, now: number): Promise<string | null> {
  try { return (await publishedSeasons(sb, now))?.find((s) => phaseOf(s, now) === "ACTIVE")?.id ?? null; } catch { return null; }
}

interface Snapshot { model: TeamCollectionsModel; owned: Set<string>; counts: Record<string, number>; stored: Stored; season: string | null }

async function snapshot(sb: SupabaseClient, userId: string, now: number): Promise<Snapshot> {
  const [model, summary, stored, season] = await Promise.all([
    teamCollectionsModel(sb), loadCollectionSummary(sb, userId), readPersisted(sb, userId), activeSeasonId(sb, now),
  ]);
  return { model, owned: ownedCardIdsOf(summary), counts: countsOf(summary), stored, season };
}

const planOf = (s: Snapshot) => settlePlan(s.model, s.owned, s.stored, s.season !== null);
const hasWork = (s: Snapshot): boolean => { if (!s.stored.available) return false; const p = planOf(s); return p.teams.length > 0 || p.regions.length > 0; };
const viewOf = (s: Snapshot): TeamCollectionsView => teamCollectionsView(s.model, s.owned, s.stored, hasWork(s));

// ───────────────────────────── Lectura ─────────────────────────────

export async function getTeamCollections(sb: SupabaseClient, userId: string, now = Date.now()): Promise<TeamCollectionsResult<TeamCollectionsView>> {
  return ok(viewOf(await snapshot(sb, userId, now)));
}

export async function getTeamCollection(sb: SupabaseClient, userId: string, teamId: unknown, now = Date.now()): Promise<TeamCollectionsResult<TeamDetailView>> {
  if (typeof teamId !== "string" || !TEAM_ID_PATTERN.test(teamId)) return fail(400, "BAD_TEAM", "Equipo no válido");
  const s = await snapshot(sb, userId, now);
  const team = s.model.teams.find((t) => t.id === teamId);
  if (!team) return fail(404, "NOT_FOUND", "Ese equipo no tiene colección");
  return ok(teamDetail(team, s.counts, s.stored));
}

/** Regiones cuya insignia tiene guardada una cuenta (para pintarla en un perfil, propio o ajeno). */
export async function unlockedRegions(sb: SupabaseClient, userId: string): Promise<Region[]> {
  const { data, error } = await sb.from("user_region_badges").select("region").eq("user_id", userId);
  if (error) return [];
  return ((data ?? []) as { region: Region }[]).map((r) => r.region);
}

// ───────────────────────────── Liquidación ─────────────────────────────

export interface SettleView {
  /** Equipos completados por primera vez en ESTA llamada, o cuyos XP pendientes se han cobrado ahora. */
  teams: { id: string; title: string; xp: number; first: boolean }[];
  /** Insignias regionales desbloqueadas en ESTA llamada. */
  regions: Region[];
  xpGained: number;
  view: TeamCollectionsView;
}

/**
 * Guarda lo que la cuenta cumple HOY y aún no consta. No recibe nada del cliente: el plan sale del catálogo y del
 * inventario leídos aquí, y la base vuelve a comprobar cada carta dentro de su transacción. Repetirla no hace nada.
 */
export async function settleTeamCollections(sb: SupabaseClient, userId: string, now = Date.now()): Promise<TeamCollectionsResult<SettleView>> {
  const before = await snapshot(sb, userId, now);
  if (!before.stored.available) return fail(503, "NOT_READY", "Las recompensas de colección aún no están disponibles");
  const plan = planOf(before);
  if (plan.teams.length === 0 && plan.regions.length === 0) return ok({ teams: [], regions: [], xpGained: 0, view: viewOf(before) });

  const { data, error } = await sb.rpc("app_team_collections_settle", {
    p_user: userId, p_teams: plan.teams, p_regions: plan.regions, p_season: before.season, p_xp: TEAM_COLLECTION_XP,
  });
  if (error) {
    if (isMissingRelation(error) || /app_team_collections_settle/i.test(error.message ?? "")) return fail(503, "NOT_READY", "Las recompensas de colección aún no están disponibles");
    throw new Error(error.message);
  }
  const res = (data ?? {}) as { code?: string; xpGained?: number; teams?: { id: string; code: string; xp: number }[]; regions?: { region: Region; code: string }[] };
  if (res.code !== "OK") return fail(500, "UNAVAILABLE", "No se pudo completar la operación");
  const title = new Map(before.model.teams.map((t) => [t.id, t.title]));
  const after = await snapshot(sb, userId, now);
  return ok({
    teams: (res.teams ?? []).filter((t) => t.code === "COMPLETED" || t.code === "XP_GRANTED").map((t) => ({ id: t.id, title: title.get(t.id) ?? t.id, xp: t.xp, first: t.code === "COMPLETED" })),
    regions: (res.regions ?? []).filter((r) => r.code === "UNLOCKED").map((r) => r.region),
    xpGained: res.xpGained ?? 0,
    view: viewOf(after),
  });
}
