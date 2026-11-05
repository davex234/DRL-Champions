/**
 * `/api/game/collection-sets` — F82 · SALA DE TROFEOS.
 *
 *   GET                                  → sets publicados (y los retirados que completaste) con TU progreso, insignias,
 *                                          compleciones recientes. Lo calcula el servidor contra `user_cards`.
 *   POST { action: "claim", setId }      → reclama la insignia de un set completado (atómico, exactamente una vez).
 *
 * El usuario sale SIEMPRE del Bearer. GET sin parámetros; POST con cuerpo CERRADO. Los borradores no salen nunca.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import { claimSet, getTrophyRoom, type SetsResult } from "@/server/services/collectionSets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const BODY_KEYS: Record<string, readonly string[]> = { claim: ["action", "setId"] };

const bad = (error: string, code = "BAD_REQUEST", status = 400) => NextResponse.json({ error, code }, { status, headers: NO_STORE });

function reply<T>(r: SetsResult<T>) {
  if (!r.ok && r.status >= 500 && r.status !== 503) return NextResponse.json({ error: "No se pudo completar la operación", code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  return NextResponse.json(r.ok ? r.data : { error: r.error, code: r.code }, { status: r.status, headers: NO_STORE });
}

export async function GET(req: Request) {
  if ([...new URL(req.url).searchParams.keys()].length > 0) return bad("Parámetro no válido");
  const session = await getSession(req);
  if (!session) return bad("Inicia sesión para ver tu Sala de Trofeos", "UNAUTHENTICATED", 401);
  const rate = await takeRate(session.admin, session.userId, "collection_read");
  if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, ...rateHeaders(rate.retryAfter) } });
  try {
    return reply(await getTrophyRoom(session.admin, session.userId));
  } catch (e) {
    console.error("[collection-sets]", e instanceof Error ? e.message : "error");
    if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: { ...NO_STORE, ...rateHeaders(5) } });
    return bad("No se pudo leer tu Sala de Trofeos", "SERVER_ERROR", 500);
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
  const rate = await takeRate(session.admin, session.userId, "collection_write");
  if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, ...rateHeaders(rate.retryAfter) } });
  try {
    return reply(await claimSet(session.admin, session.userId, body.setId));
  } catch (e) {
    console.error("[collection-sets]", e instanceof Error ? e.message : "error");
    return bad("No se pudo reclamar", "SERVER_ERROR", 500);
  }
}
