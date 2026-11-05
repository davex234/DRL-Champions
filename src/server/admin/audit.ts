/**
 * F58 · AUDITORÍA — escritura y lectura del registro (`content_audit_log`, 0040 + columnas de 0055).
 *
 * Escribir: `app_admin_audit` (comprueba que el actor es admin y el formato de la acción). Las acciones transaccionales
 * (sanción, créditos, publicar evento) se auditan DENTRO de su propia RPC, no aquí.
 * Leer: paginado en servidor con filtros por actor, acción, entidad y fecha. La tabla es append-only (trigger de 0055):
 * no existe ninguna ruta que la edite ni la borre.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, rpcFailure, type AdminResult } from "./http";
import { redactSecrets } from "@/domain/admin/redact";

export interface AuditRow {
  id: number; at: string; actor: string | null; actorName: string | null; action: string;
  entityType: string | null; entityId: string | null; cardId: string | null; poolId: string | null; detail: Record<string, unknown>;
}

export async function writeAudit(sb: SupabaseClient, actor: string, action: string, entityType: string, entityId: string, detail: Record<string, unknown>): Promise<AdminResult<true>> {
  const { error } = await sb.rpc("app_admin_audit", { p_actor: actor, p_action: action, p_entity_type: entityType, p_entity_id: entityId, p_detail: redactSecrets(detail) });
  return error ? rpcFailure(error.message) : ok(true as const);
}

export interface AuditFilters { actor?: string; action?: string; entityType?: string; entityId?: string; from?: string; to?: string; q?: string; page?: number; pageSize?: number }

const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
const SAFE = /^[A-Za-z0-9_:.\-@ ]{1,80}$/;

export async function listAudit(sb: SupabaseClient, f: AuditFilters): Promise<AdminResult<{ rows: AuditRow[]; total: number; page: number; pageSize: number }>> {
  const page = Math.max(1, Math.trunc(f.page ?? 1));
  const pageSize = Math.min(Math.max(Math.trunc(f.pageSize ?? 50), 1), 100);
  for (const [k, v] of Object.entries({ actor: f.actor, action: f.action, entityType: f.entityType, entityId: f.entityId, q: f.q })) {
    if (v != null && v !== "" && !SAFE.test(v)) return fail(400, `Filtro inválido: ${k}`);
  }
  if ((f.from && !ISO.test(f.from)) || (f.to && !ISO.test(f.to))) return fail(400, "Fecha inválida");

  let q = sb.from("content_audit_log").select("id, at, actor, action, entity_type, entity_id, card_id, pool_id, detail", { count: "exact" });
  if (f.actor) q = q.eq("actor", f.actor);
  if (f.action) q = q.eq("action", f.action);
  if (f.entityType) q = q.eq("entity_type", f.entityType);
  if (f.entityId) q = f.entityType === "card" ? q.eq("card_id", f.entityId) : f.entityType === "pool" ? q.eq("pool_id", f.entityId) : q.eq("entity_id", f.entityId);
  if (f.from) q = q.gte("at", f.from);
  if (f.to) q = q.lte("at", f.to);
  if (f.q) { const t = f.q.replace(/[%,()]/g, ""); q = q.or(`action.ilike.%${t}%,card_id.ilike.%${t}%,pool_id.ilike.%${t}%,entity_id.ilike.%${t}%`); }
  const { data, error, count } = await q.order("at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  if (error) return fail(500, "No se pudo leer el registro");

  const raw = (data ?? []) as { id: number; at: string; actor: string | null; action: string; entity_type: string | null; entity_id: string | null; card_id: string | null; pool_id: string | null; detail: Record<string, unknown> | null }[];
  const actors = [...new Set(raw.map((r) => r.actor).filter((a): a is string => !!a))];
  const names = new Map<string, string>();
  if (actors.length) {
    const { data: ps } = await sb.from("profiles").select("id, username").in("id", actors);
    for (const p of (ps ?? []) as { id: string; username: string }[]) names.set(p.id, p.username);
  }
  const rows: AuditRow[] = raw.map((r) => ({
    id: r.id, at: r.at, actor: r.actor, actorName: r.actor ? names.get(r.actor) ?? null : null, action: r.action,
    entityType: r.entity_type ?? (r.card_id ? "card" : r.pool_id ? "pool" : null),
    entityId: r.entity_id ?? r.card_id ?? r.pool_id, cardId: r.card_id, poolId: r.pool_id,
    detail: redactSecrets(r.detail ?? {}),
  }));
  return ok({ rows, total: count ?? rows.length, page, pageSize });
}

/** Actividad administrativa de UNA entidad (historial en fichas). */
export async function entityActivity(sb: SupabaseClient, entityType: string, entityId: string, limit = 20): Promise<AuditRow[]> {
  const r = await listAudit(sb, { entityType, entityId, pageSize: limit });
  return r.ok ? r.data.rows : [];
}
