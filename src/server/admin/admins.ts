/**
 * 0067 · ADMINISTRADORES — quién es admin, buscar cuentas y conceder / quitar `profiles.is_admin`.
 *
 * No es un sistema de roles: el admin sigue siendo `profiles.is_admin`. Lo único que cambia es CÓMO se escribe:
 *   · SIEMPRE por `app_admin_set_admin` (0067): el actor sale del token (`runAdmin` → `verifyAdmin`), la RPC vuelve a
 *     comprobar EN LA BD que es admin, serializa el registro de admins, protege al último y audita GRANT_ADMIN /
 *     REVOKE_ADMIN en la misma transacción. Un UPDATE suelto de `is_admin` choca en la BD (guardia de 0067).
 *   · Confirmar exige escribir el TAG PÚBLICO EXACTO de la cuenta afectada (0068; «#7K4M92X», sin distinguir mayúsculas):
 *     el nombre puede cambiar, el tag no. Lo compara el servidor, no solo el diálogo. (Sin tag —antes de 0068—, el nombre.)
 *   · La búsqueda es por nombre público (prefijo) o por «#TAG» EXACTO, sin correo ni metadatos de autenticación.
 */
import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, json, ok, readBody, respond, rpcFailure, runAdmin, type AdminDeps, type AdminResult } from "./http";
import { isUuid } from "@/domain/admin/sanctions";
import { formatTag, looksLikeTagQuery, normalizeTag } from "@/domain/account/tag";

export interface AdminAccount { userId: string; username: string; avatar: string; isAdmin: boolean; /** 0068 · tag público (sin «#»). */ tag: string | null }
export interface AdminRosterRow extends AdminAccount { grantedAt: string | null; grantedBy: string | null; self: boolean }
export interface AdminRoster { admins: AdminRosterRow[]; count: number }

export type SetAdminCode = "GRANTED" | "REVOKED" | "ALREADY_ADMIN" | "ALREADY_NOT_ADMIN";
export interface SetAdminResult { code: SetAdminCode; userId: string; username: string; tag: string | null; isAdmin: boolean; admins: number }

const SEARCH_MIN = 2;
const SEARCH_LIMIT = 20;
const REASON_MAX = 300;

type ProfileRow = { id: string; username: string; avatar: string | null; is_admin: boolean; public_tag?: string | null };
const COLS = "id, username, avatar, is_admin, public_tag";
const account = (p: ProfileRow): AdminAccount => ({ userId: p.id, username: p.username, avatar: p.avatar ?? "🎮", isAdmin: !!p.is_admin, tag: normalizeTag(p.public_tag ?? null) });

/** Consulta de búsqueda: recortada, sin comodines de PostgREST/LIKE, sin «@» (nunca se busca por correo). */
export function normalizeAdminQuery(q: unknown): string | null {
  if (typeof q !== "string") return null;
  const s = q.trim().replace(/[%\\,()*]/g, "").slice(0, 32);
  if (s.length < SEARCH_MIN || s.includes("@")) return null;
  return s;
}

export async function listAdmins(sb: SupabaseClient, viewer: string): Promise<AdminResult<AdminRoster>> {
  const { data, error } = await sb.from("profiles").select(COLS).eq("is_admin", true).order("username", { ascending: true });
  if (error) return fail(500, "No se pudo leer la lista de administradores");
  const rows = (data ?? []) as ProfileRow[];
  const ids = rows.map((r) => r.id);
  // Última concesión auditada de cada admin (los anteriores a 0067 se marcaron a mano: sin rastro → «antes de 0067»).
  const granted = new Map<string, { at: string; actor: string | null }>();
  if (ids.length) {
    const { data: logs } = await sb.from("content_audit_log").select("at, actor, entity_id").eq("action", "GRANT_ADMIN").in("entity_id", ids).order("at", { ascending: false });
    for (const l of (logs ?? []) as { at: string; actor: string | null; entity_id: string }[]) if (!granted.has(l.entity_id)) granted.set(l.entity_id, { at: l.at, actor: l.actor });
  }
  const actorIds = [...new Set([...granted.values()].map((g) => g.actor).filter((a): a is string => !!a))];
  const names = new Map<string, string>();
  if (actorIds.length) {
    const { data: ps } = await sb.from("profiles").select("id, username").in("id", actorIds);
    for (const p of (ps ?? []) as { id: string; username: string }[]) names.set(p.id, p.username);
  }
  return ok({
    count: rows.length,
    admins: rows.map((r) => {
      const g = granted.get(r.id) ?? null;
      return { ...account(r), grantedAt: g?.at ?? null, grantedBy: g ? (g.actor ? names.get(g.actor) ?? "—" : "operador (SQL)") : null, self: r.id === viewer };
    }),
  });
}

export async function searchAccounts(sb: SupabaseClient, rawQuery: unknown): Promise<AdminResult<{ query: string; accounts: AdminAccount[] }>> {
  // 0068 · «#TAG» = esa cuenta EXACTA (nunca difusa).
  if (looksLikeTagQuery(rawQuery)) {
    const tag = normalizeTag(rawQuery);
    if (!tag) return fail(400, "Tag inválido: 7 caracteres, por ejemplo #7K4M92X");
    const { data, error } = await sb.from("profiles").select(COLS).eq("public_tag", tag).limit(1);
    if (error) return fail(500, "No se pudo buscar");
    return ok({ query: formatTag(tag), accounts: ((data ?? []) as ProfileRow[]).map(account) });
  }
  const q = normalizeAdminQuery(rawQuery);
  if (q === null) return fail(400, "Escribe al menos 2 caracteres del nombre de usuario (no se busca por correo)");
  const pattern = `${q.replace(/_/g, "\\_")}%`;
  const { data, error } = await sb.from("profiles").select(COLS).ilike("username", pattern).order("username", { ascending: true }).limit(SEARCH_LIMIT);
  if (error) return fail(500, "No se pudo buscar");
  return ok({ query: q, accounts: ((data ?? []) as ProfileRow[]).map(account) });
}

/**
 * Conceder (`grant`) o quitar (`revoke`) admin. El ACTOR es el del token; el cuerpo solo nombra a la cuenta afectada y
 * trae la confirmación (su nombre exacto). Repetir es idempotente (ALREADY_*): un doble clic no escribe dos veces.
 */
export async function setAdmin(sb: SupabaseClient, actor: string, body: Record<string, unknown>): Promise<AdminResult<SetAdminResult>> {
  const grant = body.action === "grant" ? true : body.action === "revoke" ? false : null;
  if (grant === null) return fail(400, "Acción desconocida");
  if (!isUuid(body.userId)) return fail(400, "Usuario inválido");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length > REASON_MAX) return fail(400, "El motivo es demasiado largo (máximo 300 caracteres)");
  const { data: target, error } = await sb.from("profiles").select(COLS).eq("id", body.userId).maybeSingle();
  if (error) return fail(500, "No se pudo leer la cuenta");
  if (!target) return fail(404, "Usuario no encontrado");
  const t = target as ProfileRow;
  const tag = normalizeTag(t.public_tag ?? null);
  // 0068 · se confirma con el TAG (inequívoco y permanente); solo una cuenta sin tag (antes de 0068) cae al nombre.
  const confirmed = tag ? normalizeTag(body.confirm) === tag : typeof body.confirm === "string" && body.confirm.trim() === t.username;
  if (!confirmed) {
    return fail(400, tag ? `Para confirmar escribe el tag exacto de la cuenta: ${formatTag(tag)}` : `Para confirmar escribe el nombre exacto de la cuenta: ${t.username}`);
  }
  const { data, error: rpcError } = await sb.rpc("app_admin_set_admin", { p_actor: actor, p_target: t.id, p_grant: grant, p_reason: reason || null });
  if (rpcError) {
    console.error(`[admin] ${grant ? "GRANT_ADMIN" : "REVOKE_ADMIN"} falló: ${rpcError.message.slice(0, 160)}`);
    return rpcFailure(rpcError.message);
  }
  const r = (data ?? {}) as { code?: string; admins?: number; username?: string };
  const code = r.code as SetAdminCode;
  if (!["GRANTED", "REVOKED", "ALREADY_ADMIN", "ALREADY_NOT_ADMIN"].includes(code)) return fail(500, "No se pudo completar la operación");
  console.info(`[admin] ${grant ? "GRANT_ADMIN" : "REVOKE_ADMIN"} ${code} actor=${actor.slice(0, 8)} target=${t.id.slice(0, 8)}`);
  return ok({ code, userId: t.id, username: r.username ?? t.username, tag, isAdmin: grant, admins: typeof r.admins === "number" ? r.admins : 0 });
}

type H = (req: Request) => Promise<NextResponse>;

/** `/api/admin/admins` — GET: lista (o `?q=` búsqueda) · POST: { action: "grant" | "revoke", userId, confirm, reason? }. */
export function adminsHandlers(deps: AdminDeps): { GET: H; POST: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb, userId }) => {
      const q = new URL(req.url).searchParams.get("q");
      return q !== null ? respond(await searchAccounts(sb, q)) : respond(await listAdmins(sb, userId));
    }),
    POST: (req) => runAdmin(req, deps, "admin_write", async ({ sb, userId }) => {
      const r = await readBody(req, ["action", "userId", "confirm", "reason"]);
      if (!r.ok) return r.res;
      if (r.body.action !== "grant" && r.body.action !== "revoke") return json({ error: "Acción desconocida" }, 400);
      return respond(await setAdmin(sb, userId, r.body));
    }),
  };
}
