/**
 * F82 · COLLECTION SETS — SERVIDOR (jugador). Sala de Trofeos y reclamo de insignias.
 *
 *   · El progreso se calcula SIEMPRE aquí, contra `user_cards` (paginado y ordenado): el cliente no decide nada.
 *   · Evaluación PEREZOSA: no hay ganchos en sobres/recompensas/crafteo ni backfill. Cualquier vía legítima que añada
 *     una carta a `user_cards` (sobre, recompensa, crafteo, proyecto, admin) se refleja la próxima vez que se lee la
 *     sala; un usuario que ya cumplía un set al publicarse puede reclamarlo sin volver a conseguir nada.
 *   · Reclamo = `app_collection_claim` (0062): comprueba de nuevo en la MISMA transacción, inserta la compleción con
 *     PK (usuario, set) y concede la insignia en `user_cosmetics`. Doble clic, dos pestañas o reintento → una insignia.
 *   · Los borradores NO salen nunca de aquí. Un set retirado solo se ve si el usuario lo completó (es su trofeo).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { CARDS } from "@/data/catalog";
import { pageAll } from "@/server/db/pageAll";
import { isMissingRelation } from "@/server/services/f73Config";
import { badgeFact, badgeIndex, cupSlugOf, type BadgeFact, type CupTrophyInfo } from "@/domain/collectionSets/badges";
import { buildSetView, type SetView, type TrophyRoomView } from "@/domain/collectionSets/view";
import { ingestSeasonEvent } from "./seasonTrack";

export type { SetView, TrophyRoomView };
import { SET_ID_PATTERN, type CollectionSetDef, type SetKind, type SetRequirement, type SetStatus } from "@/domain/collectionSets/types";

export interface SetsResult<T> { ok: boolean; status: number; error?: string; code?: string; data?: T }
const ok = <T,>(data: T): SetsResult<T> => ({ ok: true, status: 200, data });
const fail = (status: number, code: string, error: string): SetsResult<never> => ({ ok: false, status, code, error });

// ───────────────────────────── Lectura ─────────────────────────────

interface SetRow {
  id: string; family: string; version: number; kind: string; subject_id: string; title: string; status: string;
  requirements: unknown; reward: unknown; logo: string | null; checksum: string | null;
  published_at: string | null; retired_at: string | null; row_version: number;
}
export const SET_COLUMNS = "id, family, version, kind, subject_id, title, status, requirements, reward, logo, checksum, published_at, retired_at, row_version";

function asRequirements(v: unknown): SetRequirement[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((r): SetRequirement[] => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    const cardIds = Array.isArray(o.cardIds) ? o.cardIds.filter((c): c is string => typeof c === "string") : [];
    if (typeof o.key !== "string" || typeof o.playerId !== "string") return [];
    return [{ key: o.key, type: o.type === "SPECIFIC_CARD" ? "SPECIFIC_CARD" : "PLAYER_ANY_CARD", playerId: o.playerId, label: typeof o.label === "string" ? o.label : o.playerId, cardIds }];
  });
}

export function fromRow(r: SetRow): CollectionSetDef {
  const reward = (r.reward && typeof r.reward === "object" ? r.reward : {}) as { badgeId?: unknown };
  return {
    id: r.id, family: r.family, version: r.version, kind: (r.kind === "EDITION" ? "EDITION" : "TEAM") as SetKind,
    subjectId: r.subject_id, title: r.title, status: r.status as SetStatus, requirements: asRequirements(r.requirements),
    reward: { badgeId: typeof reward.badgeId === "string" ? reward.badgeId : "" }, logo: r.logo, checksum: r.checksum,
    publishedAt: r.published_at, retiredAt: r.retired_at, rowVersion: r.row_version,
  };
}

/** Sets visibles para jugadores: PUBLISHED y RETIRED (los retirados solo se enseñan a quien los completó). */
async function visibleSets(sb: SupabaseClient): Promise<CollectionSetDef[]> {
  const { data, error } = await sb.from("collection_sets").select(SET_COLUMNS).in("status", ["PUBLISHED", "RETIRED"]).order("id");
  if (error) throw error;
  return ((data ?? []) as SetRow[]).map(fromRow);
}

/** Ids de carta DISTINTOS del usuario. Paginado con orden estable (PostgREST corta en 1.000). */
export async function ownedCardIds(sb: SupabaseClient, userId: string): Promise<Set<string>> {
  const rows = await pageAll<{ card_id: string }>((a, b) =>
    sb.from("user_cards").select("card_id, uid").eq("user_id", userId).order("uid").range(a, b));
  if (rows === null) throw new Error("user_cards ilegible");
  return new Set(rows.map((r) => r.card_id));
}

async function completionsOf(sb: SupabaseClient, userId: string): Promise<Map<string, string>> {
  const { data, error } = await sb.from("user_collection_completions").select("set_id, completed_at").eq("user_id", userId);
  if (error) throw error;
  return new Map(((data ?? []) as { set_id: string; completed_at: string }[]).map((r) => [r.set_id, r.completed_at]));
}

async function ownedBadgeIds(sb: SupabaseClient, userId: string): Promise<string[]> {
  // Un usuario tiene pocas decenas de cosméticos: se filtra la familia aquí (sin depender de LIKE).
  const { data, error } = await sb.from("user_cosmetics").select("cosmetic_id").eq("user_id", userId);
  if (error) throw error;
  return ((data ?? []) as { cosmetic_id: string }[]).map((r) => r.cosmetic_id).filter((id) => id.startsWith("insignia:")).sort();
}

/**
 * F86 · nombre y fecha de los torneos COMPLETADOS cuyos trofeos aparecen (una consulta por slug). Sin 0069 o sin el
 * torneo, el trofeo no se pinta: nunca un nombre inventado.
 */
async function cupTrophies(sb: SupabaseClient, ids: readonly string[]): Promise<Map<string, CupTrophyInfo>> {
  const slugs = [...new Set(ids.map(cupSlugOf).filter((x): x is string => !!x))];
  const out = new Map<string, CupTrophyInfo>();
  if (!slugs.length) return out;
  const { data, error } = await sb.from("cups").select("slug, name, completed_at").in("slug", slugs).eq("status", "COMPLETED");
  if (error) return out;
  for (const c of (data ?? []) as { slug: string; name: string; completed_at: string | null }[]) out.set(c.slug, { name: c.name, completedAt: c.completed_at });
  return out;
}

export async function getTrophyRoom(sb: SupabaseClient, userId: string): Promise<SetsResult<TrophyRoomView>> {
  let sets: CollectionSetDef[];
  try { sets = await visibleSets(sb); } catch (e) {
    if (isMissingRelation(e as never)) return fail(503, "NOT_READY", "La Sala de Trofeos aún no está disponible");
    throw e;
  }
  const [owned, done, badgeIds, custom] = await Promise.all([
    ownedCardIds(sb, userId), completionsOf(sb, userId), ownedBadgeIds(sb, userId),
    sb.from("player_profile_customization").select("featured_badge_ids, version").eq("user_id", userId).maybeSingle(),
  ]);
  const index = badgeIndex(sets);
  const cups = await cupTrophies(sb, badgeIds);
  // Un set retirado que el usuario no completó deja de ser un objetivo: no se enseña.
  const views = sets.filter((s) => s.status === "PUBLISHED" || done.has(s.id)).map((s) => buildSetView(s, owned, done.get(s.id) ?? null, index));
  const catalogIds = new Set(CARDS.map((c) => c.id));
  const ownedDistinct = [...owned].filter((id) => catalogIds.has(id)).length;
  const unlocked = badgeIds.map((id) => badgeFact(id, index, cups)).filter((b): b is BadgeFact => b !== null);
  const unlockedIds = new Set(unlocked.map((b) => b.id));
  const locked = views.filter((v) => !v.retired && v.badge && !unlockedIds.has(v.badge.id)).map((v) => v.badge as BadgeFact);
  const team = views.filter((v) => v.kind === "TEAM" && !v.retired);
  const row = (custom.data ?? null) as { featured_badge_ids?: string[]; version?: number } | null;
  const recent = views.filter((v) => v.completedAt).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")).slice(0, 5)
    .map((v) => ({ setId: v.id, title: v.title, completedAt: v.completedAt as string, badge: v.badge }));
  return ok({
    totals: {
      teamSets: team.length, teamsCompleted: views.filter((v) => v.kind === "TEAM" && v.completedAt).length,
      sets: views.filter((v) => !v.retired).length, setsCompleted: views.filter((v) => v.completedAt).length,
      claimable: views.filter((v) => v.state === "CLAIMABLE").length, badgesUnlocked: unlocked.length,
      collectionBadges: unlocked.filter((b) => b.kind === "TEAM" || b.kind === "EDITION").length, // F83 · las de temporada no son de colección
      ownedDistinct, catalogCards: catalogIds.size, collectionPct: catalogIds.size ? Math.floor((ownedDistinct / catalogIds.size) * 100) : 0,
    },
    sets: views, badges: { unlocked, locked }, recent,
    featuredBadgeIds: Array.isArray(row?.featured_badge_ids) ? row.featured_badge_ids : [],
    profileVersion: typeof row?.version === "number" ? row.version : 0,
  });
}

// ───────────────────────────── Reclamo ─────────────────────────────

export interface ClaimView { setId: string; outcome: "COMPLETED" | "ALREADY"; badge: BadgeFact | null; completedAt: string | null; set: SetView | null }

export async function claimSet(sb: SupabaseClient, userId: string, setId: unknown): Promise<SetsResult<ClaimView>> {
  if (typeof setId !== "string" || !SET_ID_PATTERN.test(setId)) return fail(400, "BAD_SET", "Colección no válida");
  const { data, error } = await sb.rpc("app_collection_claim", { p_user: userId, p_set: setId });
  if (error) {
    if (/app_collection_claim|PGRST202|does not exist/i.test(error.message ?? "")) return fail(503, "NOT_READY", "La Sala de Trofeos aún no está disponible");
    throw new Error(error.message);
  }
  const res = (data ?? {}) as { code?: string; missing?: number; completedAt?: string };
  switch (res.code) {
    case "COMPLETED": case "ALREADY": {
      // F83 · una colección completada AHORA (no las anteriores) da XP de temporada una vez (clave por set). Nunca lanza.
      if (res.code === "COMPLETED") await ingestSeasonEvent(sb, userId, { kind: "COLLECTION", key: `collection:${setId}`, setId });
      const room = await getTrophyRoom(sb, userId);
      const set = room.data?.sets.find((s) => s.id === setId) ?? null;
      return ok({ setId, outcome: res.code, badge: set?.badge ?? null, completedAt: res.completedAt ?? set?.completedAt ?? null, set });
    }
    case "INCOMPLETE": return fail(409, "INCOMPLETE", `Te falta${res.missing === 1 ? "" : "n"} ${res.missing ?? "?"} para completarla`);
    case "RETIRED": return fail(409, "RETIRED", "Esta colección ya no está activa");
    case "NOT_FOUND": return fail(404, "NOT_FOUND", "Esa colección no existe");
    default: return fail(500, "UNAVAILABLE", "No se pudo completar la operación");
  }
}

// ───────────────────────────── Perfil (insignias destacadas) ─────────────────────────────

/** Hechos de insignia para pintar en un perfil (propio o ajeno). Solo PUBLISHED/RETIRED: un borrador no da nombre ni logo. */
export async function badgeFactsFor(sb: SupabaseClient, ids: readonly string[]): Promise<BadgeFact[]> {
  if (!ids.length) return [];
  let index = new Map<string, CollectionSetDef>();
  try { index = badgeIndex(await visibleSets(sb)); } catch { /* sin 0062: solo las de maestría */ }
  const cups = await cupTrophies(sb, ids);
  return ids.map((id) => badgeFact(id, index, cups)).filter((b): b is BadgeFact => b !== null);
}

export { ownedBadgeIds };
