/**
 * F58 · MODERACIÓN — emitir, revocar y consultar sanciones (`user_sanctions`, 0055) + la consulta que usa el
 * ENFORCEMENT (`getSession` y el middleware).
 *
 * Las escrituras van SIEMPRE por las RPC transaccionales (sanción + auditoría en la misma transacción, con las reglas
 * de seguridad en SQL: no auto-sanción, no sancionar a otro admin, una sanción activa por usuario).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, rpcFailure, type AdminResult } from "./http";
import { cleanReason, expiresAtFor, isUuid, sanctionStatus, type SanctionInput, type SanctionRow, type SanctionStatus } from "@/domain/admin/sanctions";
import { invalidateSanctionCache } from "@/server/services/sanctionGate";

export async function issueSanction(sb: SupabaseClient, actor: string, input: SanctionInput, now = Date.now()): Promise<AdminResult<SanctionRow>> {
  if (input.userId === actor) return fail(409, "No puedes sancionar tu propia cuenta");
  const { data, error } = await sb.rpc("app_admin_sanction", {
    p_user: input.userId, p_type: input.type, p_reason: input.reason, p_expires_at: expiresAtFor(input.hours, now), p_actor: actor,
  });
  if (error) return rpcFailure(error.message);
  invalidateSanctionCache(input.userId);
  return ok(data as SanctionRow);
}

export async function revokeSanction(sb: SupabaseClient, actor: string, sanctionId: unknown, reasonRaw: unknown): Promise<AdminResult<SanctionRow>> {
  if (!isUuid(sanctionId)) return fail(400, "Sanción inválida");
  const reason = cleanReason(reasonRaw);
  if (!reason) return fail(400, "El motivo de la revocación es obligatorio");
  const { data, error } = await sb.rpc("app_admin_revoke_sanction", { p_id: sanctionId, p_reason: reason, p_actor: actor });
  if (error) return rpcFailure(error.message);
  const row = data as SanctionRow;
  invalidateSanctionCache(row.user_id);
  return ok(row);
}

export interface SanctionView extends SanctionRow { status: SanctionStatus; username: string | null; createdByName: string | null; revokedByName: string | null }

export async function listSanctions(sb: SupabaseClient, f: { userId?: string; status?: string; page?: number; pageSize?: number }, now = Date.now()): Promise<AdminResult<{ rows: SanctionView[]; total: number; page: number; pageSize: number }>> {
  const page = Math.max(1, Math.trunc(f.page ?? 1));
  const pageSize = Math.min(Math.max(Math.trunc(f.pageSize ?? 50), 1), 100);
  if (f.userId && !isUuid(f.userId)) return fail(400, "Usuario inválido");
  let q = sb.from("user_sanctions").select("*", { count: "exact" });
  if (f.userId) q = q.eq("user_id", f.userId);
  if (f.status === "ACTIVE") q = q.is("revoked_at", null);
  if (f.status === "REVOKED") q = q.not("revoked_at", "is", null);
  const { data, error, count } = await q.order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  if (error) return fail(500, "No se pudieron leer las sanciones");
  let rows = (data ?? []) as SanctionRow[];
  // ACTIVE también excluye las caducadas (la caducidad es por reloj, no por columna).
  if (f.status === "ACTIVE") rows = rows.filter((r) => sanctionStatus(r, now) === "ACTIVE");
  if (f.status === "EXPIRED") rows = rows.filter((r) => sanctionStatus(r, now) === "EXPIRED");
  const ids = [...new Set(rows.flatMap((r) => [r.user_id, r.created_by, r.revoked_by]).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: ps } = await sb.from("profiles").select("id, username").in("id", ids);
    for (const p of (ps ?? []) as { id: string; username: string }[]) names.set(p.id, p.username);
  }
  return ok({
    rows: rows.map((r) => ({ ...r, status: sanctionStatus(r, now), username: names.get(r.user_id) ?? null,
      createdByName: r.created_by ? names.get(r.created_by) ?? null : null, revokedByName: r.revoked_by ? names.get(r.revoked_by) ?? null : null })),
    total: count ?? rows.length, page, pageSize,
  });
}

export { activeSanctionFor, invalidateSanctionCache } from "@/server/services/sanctionGate";
