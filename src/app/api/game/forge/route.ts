/**
 * F79 · `/api/game/forge` — NEXUS FORGE 2.0. Todo en servidor.
 *
 *   GET                                                                       → la Forja del jugador (nivel, XP,
 *                                                                               maestría, recetas, cadenas, planos,
 *                                                                               objetivos, logros, proyectos, historial)
 *   POST { action: "craft", recipeId, uids, ref, confirmProtected? }          → forja (intercambio o receta avanzada)
 *   POST { action: "claimObjective", objectiveId }                            → recompensa de objetivo (idempotente)
 *   POST { action: "claimAchievement", achievementId }                        → recompensa de logro (idempotente)
 *   POST { action: "view", recipeId }                                         → solo analítica (recipe_view), sin escrituras
 *
 * El cliente NUNCA manda XP, nivel, desbloqueos, progreso, cantidades, carta de salida ni recompensa: cualquier campo
 * fuera de la lista se rechaza. `confirmProtected` = copias protegidas (favoritas/vitrina) que el jugador CONFIRMÓ
 * entregar; solo puede restringir, nunca ampliar lo que el servidor ya permite.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { internalError } from "@/server/ops/log";
import { takeRate, rateHeaders, TOO_MANY } from "@/server/services/rateLimit";
import { ensureServerPacks } from "@/server/cms/packs";
import { claimAchievement, claimObjective, forgeCraft, getForgeState } from "@/server/services/forge";
import { logForge } from "@/server/services/forgeConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 12_000;
const ALLOWED = new Set(["action", "recipeId", "uids", "ref", "confirmProtected", "objectiveId", "achievementId"]);
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (error: string) => NextResponse.json({ error, code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
const uuidList = (v: unknown, max: number): string[] | null =>
  Array.isArray(v) && v.length <= max && v.every((u) => typeof u === "string" && UUID.test(u)) ? (v as string[]) : null;

function send<T>(r: { ok: boolean; status: number; error?: string; code?: string; data?: T }) {
  if (!r.ok) return NextResponse.json({ error: r.status >= 500 ? "No se pudo completar la forja" : r.error, ...(r.code ? { code: r.code } : {}) }, { status: r.status, headers: NO_STORE });
  return NextResponse.json(r.data, { status: 200, headers: NO_STORE });
}

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  { const rate = await takeRate(session.admin, session.userId, "collection_read"); if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) }); }
  try {
    await ensureServerPacks(session.admin);
    const out = await getForgeState(session.admin, session.userId);
    if (out.ok) logForge("info", "forge_open", { level: out.data?.core.level.level ?? null });
    return send(out);
  } catch (e) { return internalError("api/game/forge", e, req); }
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  let raw = "";
  try { raw = await req.text(); } catch { /* ilegible */ }
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Cuerpo demasiado grande" }, { status: 413, headers: NO_STORE });
  let body: Record<string, unknown> = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* no JSON */ }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
  if (Object.keys(body).some((k) => !ALLOWED.has(k))) return NextResponse.json({ error: "Campo no permitido", code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
  const action = typeof body.action === "string" ? body.action : "";
  // `view` solo registra analítica (no escribe nada): va con el cupo de LECTURA para no gastar el de forjar.
  { const rate = await takeRate(session.admin, session.userId, action === "view" ? "collection_read" : "economy_write"); if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) }); }
  try {
    if (action === "view") {
      const recipeId = typeof body.recipeId === "string" && ID.test(body.recipeId) ? body.recipeId : "";
      if (!recipeId) return bad("Receta inválida");
      logForge("info", "recipe_view", { recipeId });
      return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
    }
    if (action === "craft") {
      const recipeId = typeof body.recipeId === "string" && ID.test(body.recipeId) ? body.recipeId : "";
      if (!recipeId) return bad("Receta inválida");
      const uids = uuidList(body.uids, 100);
      if (!uids) return bad("Selección inválida");
      const confirm = body.confirmProtected === undefined ? [] : uuidList(body.confirmProtected, 100);
      if (!confirm) return bad("Confirmación inválida");
      const ref = typeof body.ref === "string" && /^[\w:-]{8,128}$/.test(body.ref) ? body.ref : undefined;
      await ensureServerPacks(session.admin);
      return send(await forgeCraft(session.admin, session.userId, recipeId, uids, ref, confirm));
    }
    if (action === "claimObjective") {
      const id = typeof body.objectiveId === "string" && ID.test(body.objectiveId) ? body.objectiveId : "";
      return id ? send(await claimObjective(session.admin, session.userId, id)) : bad("Objetivo inválido");
    }
    if (action === "claimAchievement") {
      const id = typeof body.achievementId === "string" && ID.test(body.achievementId) ? body.achievementId : "";
      return id ? send(await claimAchievement(session.admin, session.userId, id)) : bad("Logro inválido");
    }
    return bad("Acción inválida");
  } catch (e) { return internalError("api/game/forge", e, req); }
}
