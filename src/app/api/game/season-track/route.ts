/**
 * `/api/game/season-track` — F83 · RUTA DE TEMPORADA.
 *
 *   GET                                         → vista agregada: temporada (activa / en gracia / programada), nivel y XP,
 *                                                 ruta con reclamables, retos diarios y semanales, últimas XP, historial.
 *                                                 Sin escrituras al leer. Sin parámetros (el usuario sale del Bearer).
 *   POST { action: "claim", seasonId, level }   → reclama la recompensa de un nivel alcanzado (exactamente una vez).
 *
 * El cliente NUNCA envía XP ni progreso: la XP la producen los eventos del servidor (partidas, crafteos, colecciones).
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import { claimSeasonLevel, getSeasonOverview, type SeasonOut } from "@/server/services/seasonTrack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const BODY_KEYS: Record<string, readonly string[]> = { claim: ["action", "seasonId", "level"] };
const bad = (error: string, code = "BAD_REQUEST", status = 400) => NextResponse.json({ error, code }, { status, headers: NO_STORE });

function reply<T>(r: SeasonOut<T>) {
  if (!r.ok && r.status >= 500 && r.status !== 503) return NextResponse.json({ error: "No se pudo completar la operación", code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  return NextResponse.json(r.ok ? r.data : { error: r.error, code: r.code }, { status: r.status, headers: NO_STORE });
}

export async function GET(req: Request) {
  if ([...new URL(req.url).searchParams.keys()].length > 0) return bad("Parámetro no válido");
  const session = await getSession(req);
  if (!session) return bad("Inicia sesión para ver tu temporada", "UNAUTHENTICATED", 401);
  const rate = await takeRate(session.admin, session.userId, "season_read");
  if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, ...rateHeaders(rate.retryAfter) } });
  try {
    return reply(await getSeasonOverview(session.admin, session.userId));
  } catch (e) {
    console.error("[season-track]", e instanceof Error ? e.message : "error");
    if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: { ...NO_STORE, ...rateHeaders(5) } });
    return bad("No se pudo leer tu temporada", "SERVER_ERROR", 500);
  }
}

export async function POST(req: Request) {
  if ([...new URL(req.url).searchParams.keys()].length > 0) return bad("Parámetro no válido");
  const session = await getSession(req);
  if (!session) return bad("Inicia sesión", "UNAUTHENTICATED", 401);
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 1_000) return bad("Cuerpo demasiado grande");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return bad("Cuerpo no válido");
    body = parsed as Record<string, unknown>;
  } catch { return bad("Cuerpo no válido"); }
  const action = typeof body.action === "string" ? body.action : "";
  const allowed = BODY_KEYS[action];
  if (!allowed) return bad("Acción no válida", "UNKNOWN_ACTION");
  if (Object.keys(body).some((k) => !allowed.includes(k))) return bad("Campo no permitido", "FIELD_NOT_ALLOWED");
  const rate = await takeRate(session.admin, session.userId, "economy_write");
  if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, ...rateHeaders(rate.retryAfter) } });
  try {
    return reply(await claimSeasonLevel(session.admin, session.userId, body.seasonId, body.level));
  } catch (e) {
    console.error("[season-track]", e instanceof Error ? e.message : "error");
    return bad("No se pudo reclamar", "SERVER_ERROR", 500);
  }
}
