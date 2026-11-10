/**
 * `/api/game/collection` — COLLECTION ROOM (Fase 37).
 *
 *   GET                                               → lo PERSONAL de tu colección (instancias, favoritos, vitrina, equipos)
 *   POST { action: "favorite", cardId, favorite }     → marcar/desmarcar una definición del catálogo
 *
 * El usuario sale SIEMPRE del Bearer. GET no admite parámetros (`?userId=` → 400) y no escribe nada. POST tiene cuerpo
 * CERRADO: cualquier clave distinta → 400. Las definiciones de carta son públicas y viven en el catálogo del cliente;
 * aquí no hay dinero, precio, venta ni mercado. Errores internos → mensaje genérico.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import { getCollectionPersonal, setFavorite, type CollectionResult } from "@/server/services/collection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const BODY_KEYS: Record<string, readonly string[]> = { favorite: ["action", "cardId", "favorite"] };

const bad = (error: string, code = "BAD_REQUEST", status = 400) => NextResponse.json({ error, code }, { status, headers: NO_STORE });

function reply<T>(r: CollectionResult<T>) {
  if (!r.ok && r.status >= 500 && r.status !== 503) return NextResponse.json({ error: "No se pudo completar la operación", code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  return NextResponse.json(r.ok ? r.data : { error: r.error, code: r.code }, { status: r.status, headers: NO_STORE });
}

export async function GET(req: Request) {
  if ([...new URL(req.url).searchParams.keys()].length > 0) return bad("Parámetro no válido");
  const session = await getSession(req);
  if (!session) return bad("Inicia sesión para ver tu colección", "UNAUTHENTICATED", 401);
  const rate = await takeRate(session.admin, session.userId, "collection_read");
  if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, ...rateHeaders(rate.retryAfter) } });
  try {
    return reply(await getCollectionPersonal(session.admin, session.userId));
  } catch (e) {
    console.error("[collection]", e instanceof Error ? e.message : "error");
    if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: { ...NO_STORE, ...rateHeaders(5) } });
    return bad("No se pudo leer tu colección", "SERVER_ERROR", 500);
  }
}

export async function POST(req: Request) {
  if ([...new URL(req.url).searchParams.keys()].length > 0) return bad("Parámetro no válido");
  const session = await getSession(req);
  if (!session) return bad("Inicia sesión", "UNAUTHENTICATED", 401);
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 2_000) return bad("Cuerpo demasiado grande");
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
    return reply(await setFavorite(session.admin, session.userId, body.cardId, body.favorite));
  } catch (e) {
    console.error("[collection]", e instanceof Error ? e.message : "error");
    return bad("No se pudo guardar", "SERVER_ERROR", 500);
  }
}
