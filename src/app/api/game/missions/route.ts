/**
 * F73 · `/api/game/missions` — MISIONES y PROYECTOS de carta. El progreso lo calcula SOLO el servidor.
 *
 *   GET                                              → misiones (LOCKED/ACTIVE/COMPLETED/CLAIMED) y proyectos
 *   POST { action: "claimMission", missionId }       → recompensa de una misión completada (una vez)
 *   POST { action: "claimProject", projectId }       → la carta del proyecto completado (una vez)
 *
 * No hay acción para sumar progreso: lo producen los eventos del servidor (fin de partida, apertura, crafteo).
 * Sin la migración 0059 → GET `available: false`, POST 503 `MIGRATION_PENDING`.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { internalError } from "@/server/ops/log";
import { takeRate, rateHeaders, TOO_MANY } from "@/server/services/rateLimit";
import { claimMission, claimProject, getMissionsState } from "@/server/services/missionEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const ALLOWED = new Set(["action", "missionId", "projectId"]);

function send<T>(r: { ok: boolean; status: number; error?: string; code?: string; data?: T }) {
  if (!r.ok) return NextResponse.json({ error: r.status >= 500 ? "No se pudo completar la operación" : r.error, ...(r.code ? { code: r.code } : {}) }, { status: r.status, headers: NO_STORE });
  return NextResponse.json(r.data, { status: 200, headers: NO_STORE });
}

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  { const rate = await takeRate(session.admin, session.userId, "collection_read"); if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) }); }
  try { return send(await getMissionsState(session.admin, session.userId)); } catch (e) { return internalError("api/game/missions", e, req); }
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  { const rate = await takeRate(session.admin, session.userId, "economy_write"); if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) }); }
  let body: Record<string, unknown> = {};
  try { const raw = await req.text(); if (raw.length > 2000) return NextResponse.json({ error: "Cuerpo demasiado grande" }, { status: 413, headers: NO_STORE }); body = raw ? JSON.parse(raw) : {}; } catch { /* no JSON */ }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
  if (Object.keys(body).some((k) => !ALLOWED.has(k))) return NextResponse.json({ error: "Campo no permitido", code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
  try {
    if (body.action === "claimMission" && typeof body.missionId === "string" && ID.test(body.missionId)) return send(await claimMission(session.admin, session.userId, body.missionId));
    if (body.action === "claimProject" && typeof body.projectId === "string" && ID.test(body.projectId)) return send(await claimProject(session.admin, session.userId, body.projectId));
    return NextResponse.json({ error: "Acción inválida", code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
  } catch (e) { return internalError("api/game/missions", e, req); }
}
