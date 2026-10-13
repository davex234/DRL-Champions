/**
 * F86.2 · CLOSED ALPHA en el panel (solo lectura): el FEEDBACK humano y el EMBUDO derivado.
 *
 *   · Feedback (0070 · alpha_feedback): lo ven solo administradores. Cada fila con nombre + #TAG del autor, fecha y
 *     respuestas. Nunca el correo, ni el id interno en pantalla.
 *   · Embudo (0070 · app_alpha_funnel): cuentas creadas desde una fecha y qué pasos del recorrido hay en sus DATOS
 *     (no eventos nuevos). Por defecto sin administradores ni cuentas de prueba. Son HECHOS, no opiniones: el embudo
 *     no dice si alguien «entendió» algo.
 */
import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, json, ok, respond, runAdmin, type AdminDeps, type AdminResult } from "./http";
import { normalizeTag } from "@/domain/account/tag";

export interface AdminFeedbackRow {
  id: string;
  createdAt: string;
  source: string;
  username: string;
  tag: string | null;
  hardToUnderstand: string | null;
  lostMoment: string | null;
  likedMost: string | null;
  likedLeast: string | null;
  hadError: boolean | null;
  errorDetail: string | null;
  wouldReturn: number | null;
  comment: string | null;
  appVersion: string | null;
}
export interface AdminFeedbackList { items: AdminFeedbackRow[]; count: number; limit: number; includeTest: boolean; hiddenTest: number }

const LIST_LIMIT = 200;
type FbRow = {
  id: string; user_id: string; created_at: string; source: string; hard_to_understand: string | null; lost_moment: string | null;
  liked_most: string | null; liked_least: string | null; had_error: boolean | null; error_detail: string | null;
  would_return: number | null; comment: string | null; app_version: string | null;
};

/**
 * ¿Cuenta de PRUEBA? El mismo criterio que el embudo (0070): correo `@example.invalid` (el de las cuentas QA) o nombre
 * «qa…». El correo se mira SOLO aquí, en el servidor, para filtrar; nunca sale en la respuesta.
 */
async function testAccountsOf(sb: SupabaseClient, ids: string[], names: Map<string, string>): Promise<Set<string>> {
  const out = new Set<string>();
  for (const id of ids) {
    if (/^qa/i.test(names.get(id) ?? "")) { out.add(id); continue; }
    try {
      const { data } = await sb.auth.admin.getUserById(id);
      if ((data?.user?.email ?? "").toLowerCase().endsWith("@example.invalid")) out.add(id);
    } catch { /* sin lectura: se enseña (mejor ver de más que esconder a una persona real) */ }
  }
  return out;
}

export async function listFeedback(sb: SupabaseClient, includeTest = false): Promise<AdminResult<AdminFeedbackList>> {
  const { data, error } = await sb.from("alpha_feedback")
    .select("id, user_id, created_at, source, hard_to_understand, lost_moment, liked_most, liked_least, had_error, error_detail, would_return, comment, app_version")
    .order("created_at", { ascending: false }).limit(LIST_LIMIT);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as FbRow[];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const who = new Map<string, { username: string; tag: string | null }>();
  if (ids.length) {
    const { data: ps, error: pe } = await sb.from("profiles").select("id, username, public_tag").in("id", ids);
    if (pe) throw new Error(pe.message);
    for (const p of (ps ?? []) as { id: string; username: string; public_tag: string | null }[]) who.set(p.id, { username: p.username, tag: normalizeTag(p.public_tag) });
  }
  const tests = includeTest ? new Set<string>() : await testAccountsOf(sb, ids, new Map([...who].map(([k, v]) => [k, v.username])));
  const shown = rows.filter((r) => !tests.has(r.user_id));
  return ok({
    items: shown.map((r) => ({
      id: r.id, createdAt: r.created_at, source: r.source,
      username: who.get(r.user_id)?.username ?? "Cuenta eliminada", tag: who.get(r.user_id)?.tag ?? null,
      hardToUnderstand: r.hard_to_understand, lostMoment: r.lost_moment, likedMost: r.liked_most, likedLeast: r.liked_least,
      hadError: r.had_error, errorDetail: r.error_detail, wouldReturn: r.would_return, comment: r.comment, appVersion: r.app_version,
    })),
    count: shown.length,
    limit: LIST_LIMIT,
    includeTest,
    hiddenTest: rows.length - shown.length,
  });
}

export interface AlphaFunnelPlayer {
  username: string; tag: string | null; createdAt: string; lastSignInAt: string | null;
  starterGranted: boolean; packOpened: boolean; starterClaimed: boolean; deckSaved: boolean; quickStarted: boolean;
  quickCompleted: boolean; rankedTouched: boolean; socialUsed: boolean; friendAdded: boolean; cupRegistered: boolean;
  cupPlayed: boolean; cupFinal: boolean; feedbackSent: boolean;
}
export interface AlphaFunnel { since: string; includeTest: boolean; accounts: number; steps: Record<string, number>; players: AlphaFunnelPlayer[] }

/** Fecha de inicio de la cohorte: ISO válido, no futuro, como mucho 400 días atrás. Por defecto, 14 días. */
export function parseSince(raw: string | null, now = Date.now()): string | null {
  if (raw === null || raw === "") return new Date(now - 14 * 86_400_000).toISOString();
  const t = Date.parse(raw);
  if (!Number.isFinite(t) || t > now || t < now - 400 * 86_400_000) return null;
  return new Date(t).toISOString();
}

export async function alphaFunnel(sb: SupabaseClient, since: string, includeTest: boolean): Promise<AdminResult<AlphaFunnel>> {
  const { data, error } = await sb.rpc("app_alpha_funnel", { p_since: since, p_include_test: includeTest });
  if (error) throw new Error(error.message);
  const f = (data ?? {}) as Partial<AlphaFunnel>;
  return ok({
    since, includeTest, accounts: Number(f.accounts ?? 0), steps: f.steps ?? {},
    players: (f.players ?? []).map((p) => ({ ...p, tag: normalizeTag(p.tag) })),
  });
}

type H = (req: Request) => Promise<NextResponse>;

/** `/api/admin/alpha` — GET ?view=feedback (por defecto) · GET ?view=funnel&since=<ISO>&test=1. Solo lectura. */
export function alphaHandlers(deps: AdminDeps): { GET: H } {
  return {
    GET: (req) => runAdmin(req, deps, "admin_read", async ({ sb }) => {
      const q = new URL(req.url).searchParams;
      const extra = [...q.keys()].find((k) => !["view", "since", "test"].includes(k));
      if (extra) return json({ error: "Parámetro no válido" }, 400);
      const view = q.get("view") ?? "feedback";
      if (view === "feedback") return respond(await listFeedback(sb, q.get("test") === "1"));
      if (view === "funnel") {
        const since = parseSince(q.get("since"));
        if (!since) return respond(fail(400, "Fecha de inicio no válida"));
        return respond(await alphaFunnel(sb, since, q.get("test") === "1"));
      }
      return json({ error: "Vista no válida" }, 400);
    }),
  };
}
