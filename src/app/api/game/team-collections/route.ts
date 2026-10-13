/**
 * `/api/game/team-collections` — COLECCIONES POR EQUIPO E INSIGNIAS REGIONALES.
 *
 *   GET                          → todos los equipos con cartas en el catálogo, con TU progreso (tarjetas ligeras, sin
 *                                  la lista de cartas), y las cuatro insignias regionales. Lectura pura: no escribe.
 *   GET ?team=<id>               → el detalle de un equipo: todas sus cartas, cuáles tienes y cuántas copias.
 *   POST { action: "settle" }    → guarda lo que YA cumples y aún no consta: primeras compleciones de equipo (300 XP de
 *                                  temporada, una vez por equipo) e insignias regionales, que pasan a ser permanentes.
 *                                  No lleva más datos: qué cumples lo decide el servidor, y la base lo vuelve a
 *                                  comprobar en la misma transacción. Repetirlo no concede nada dos veces.
 *
 * El usuario sale SIEMPRE del Bearer.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import { getTeamCollection, getTeamCollections, settleTeamCollections, type TeamCollectionsResult } from "@/server/services/teamCollections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const bad = (error: string, code = "BAD_REQUEST", status = 400) => NextResponse.json({ error, code }, { status, headers: NO_STORE });

function reply(r: TeamCollectionsResult<unknown>) {
  return NextResponse.json(r.ok ? r.data : { error: r.error, code: r.code }, { status: r.status, headers: NO_STORE });
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const keys = [...params.keys()];
  if (keys.some((k) => k !== "team") || params.getAll("team").length > 1) return bad("Parámetro no válido");
  const session = await getSession(req);
  if (!session) return bad("Inicia sesión para ver tus colecciones", "UNAUTHENTICATED", 401);
  const rate = await takeRate(session.admin, session.userId, "collection_read");
  if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, ...rateHeaders(rate.retryAfter) } });
  try {
    const team = params.get("team");
    return reply(team === null ? await getTeamCollections(session.admin, session.userId) : await getTeamCollection(session.admin, session.userId, team));
  } catch (e) {
    console.error("[team-collections]", e instanceof Error ? e.message : "error");
    if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: { ...NO_STORE, ...rateHeaders(5) } });
    return bad("No se pudieron leer tus colecciones", "SERVER_ERROR", 500);
  }
}

export async function POST(req: Request) {
  if ([...new URL(req.url).searchParams.keys()].length > 0) return bad("Parámetro no válido");
  const session = await getSession(req);
  if (!session) return bad("Inicia sesión", "UNAUTHENTICATED", 401);
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 200) return bad("Cuerpo demasiado grande");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return bad("Cuerpo no válido");
    body = parsed as Record<string, unknown>;
  } catch { return bad("Cuerpo no válido"); }
  if (body.action !== "settle") return bad("Acción no válida", "UNKNOWN_ACTION");
  if (Object.keys(body).some((k) => k !== "action")) return bad("Campo no permitido", "FIELD_NOT_ALLOWED");
  const rate = await takeRate(session.admin, session.userId, "collection_write");
  if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, ...rateHeaders(rate.retryAfter) } });
  try {
    return reply(await settleTeamCollections(session.admin, session.userId));
  } catch (e) {
    console.error("[team-collections]", e instanceof Error ? e.message : "error");
    if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: { ...NO_STORE, ...rateHeaders(5) } });
    return bad("No se pudieron guardar tus recompensas de colección", "SERVER_ERROR", 500);
  }
}
