/**
 * F60 · JUGADORES DEL CATÁLOGO (SOLO SERVIDOR) — alta y edición de `content_players` desde /admin/players.
 *
 * Campos: los que el modelo REAL tiene (nick, nombre, equipo actual y su tag, región, rol, país, las seis estadísticas
 * heredadas, estado activo/inactivo y foto). No se inventa ninguno. Cambiar el equipo ACTUAL no toca el equipo IMPRESO
 * de sus cartas (ese sale de la carta: manifiesto o presentación). No hay borrado: un jugador con cartas tiene una FK
 * `restrict`; se marca `inactive`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, rpcFailure, type AdminResult } from "@/server/admin/http";
import { resetServerCatalog } from "@/server/catalog";

const REGIONS = ["EMEA", "Americas", "Pacific", "China"] as const;
const ROLES = ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"] as const;
const STATS = ["dmg", "scr", "com", "hs", "ast", "clu"] as const;
const FIELDS = ["nick", "fullName", "team", "teamTag", "region", "role", "country", "stats", "status", "photoAssetId"] as const;

export function validatePlayerPatch(p: Record<string, unknown>, creating: boolean): string | null {
  const extra = Object.keys(p).filter((k) => !(FIELDS as readonly string[]).includes(k));
  if (extra.length) return `Campo no permitido: ${extra[0].slice(0, 40)}`;
  const text = (v: unknown, lo: number, hi: number) => typeof v === "string" && v.trim().length >= lo && v.trim().length <= hi && !/[<>]/.test(v);
  if ((creating || p.nick !== undefined) && !text(p.nick, 2, 24)) return "Nick de 2 a 24 caracteres (sin < ni >)";
  if (p.fullName !== undefined && p.fullName !== null && p.fullName !== "" && !text(p.fullName, 2, 80)) return "Nombre completo de 2 a 80 caracteres";
  if (p.team !== undefined && !(p.team === "" || text(p.team, 2, 40))) return "Equipo de 2 a 40 caracteres";
  if (p.teamTag !== undefined && !(p.teamTag === "" || (typeof p.teamTag === "string" && /^[A-Za-z0-9]{1,6}$/.test(p.teamTag)))) return "Tag de equipo: 1 a 6 letras o cifras";
  if ((creating || p.region !== undefined) && !(REGIONS as readonly unknown[]).includes(p.region)) return "Región: EMEA, Americas, Pacific o China";
  if ((creating || p.role !== undefined) && !(ROLES as readonly unknown[]).includes(p.role)) return "Rol del jugador inválido";
  if (p.country !== undefined && !(p.country === "" || (typeof p.country === "string" && /^[A-Z]{2}$/.test(p.country)))) return "País: código ISO de dos letras";
  if (p.status !== undefined && p.status !== "active" && p.status !== "inactive") return "Estado: activo o inactivo";
  if (creating || p.stats !== undefined) {
    const s = (p.stats ?? {}) as Record<string, unknown>;
    if (typeof s !== "object" || STATS.some((k) => !(typeof s[k] === "number" && Number.isInteger(s[k]) && (s[k] as number) >= 1 && (s[k] as number) <= 99))) {
      return "Las seis estadísticas (DMG, SCR, COM, HS, AST, CLU), enteros de 1 a 99";
    }
  }
  if (p.photoAssetId !== undefined && p.photoAssetId !== null && !(typeof p.photoAssetId === "string" && /^[0-9a-f-]{36}$/.test(p.photoAssetId))) return "Foto inválida";
  return null;
}

export async function savePlayer(sb: SupabaseClient, actor: string, body: Record<string, unknown>): Promise<AdminResult<unknown>> {
  const creating = body.expectedVersion === undefined || body.expectedVersion === null;
  const id = typeof body.id === "string" ? body.id : "";
  if (creating && !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id)) return fail(400, "Id: minúsculas, cifras, _ o -, de 2 a 40");
  const patch = (body.patch ?? {}) as Record<string, unknown>;
  if (typeof patch !== "object" || Array.isArray(patch)) return fail(400, "Cambios inválidos");
  const err = validatePlayerPatch(patch, creating);
  if (err) return fail(400, err);
  const db: Record<string, unknown> = {};
  const map: Record<string, string> = { nick: "nick", fullName: "full_name", team: "team", teamTag: "team_tag", region: "region", role: "role", country: "country", stats: "stats", status: "status", photoAssetId: "photo_asset_id" };
  for (const [k, col] of Object.entries(map)) if (patch[k] !== undefined) db[col] = typeof patch[k] === "string" ? (patch[k] as string).trim() : patch[k];
  if (db.stats) db.stats = Object.fromEntries(STATS.map((k) => [k, (patch.stats as Record<string, number>)[k]]));
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : "";
  const { data, error } = await sb.rpc("app_admin_player_save", {
    p_actor: actor, p_id: id, p_patch: db, p_expected_version: creating ? null : Number(body.expectedVersion), p_reason: reason || (creating ? "alta" : "edición"),
  });
  if (error) return rpcFailure(error.message);
  resetServerCatalog();
  return ok(data);
}

/** Cartas del jugador (todas las del catálogo, cualquier estado) y su versión de ficha, para la vista de detalle. */
export async function playerRelations(sb: SupabaseClient, id: string): Promise<AdminResult<{ version: number | null; cards: { cardId: string; lifecycle: string; printedTeamFromCard: boolean }[] }>> {
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id)) return fail(400, "Id inválido");
  const [{ data: p }, { data: c }] = await Promise.all([
    sb.from("content_players").select("version").eq("id", id).maybeSingle(),
    sb.from("content_cards").select("card_id, lifecycle").eq("player_id", id).order("card_id"),
  ]);
  if (!p) return fail(404, "Jugador no encontrado");
  return ok({
    version: (p as { version?: number }).version ?? null,
    cards: ((c ?? []) as { card_id: string; lifecycle: string }[]).map((r) => ({ cardId: r.card_id, lifecycle: r.lifecycle, printedTeamFromCard: true })),
  });
}
