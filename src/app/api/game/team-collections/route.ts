/**
 * `/api/game/team-collections` — COLECCIONES POR EQUIPO E INSIGNIAS REGIONALES. Solo lectura.
 *
 *   GET                → todos los equipos con cartas en el catálogo, con TU progreso (tarjetas ligeras, sin la lista de
 *                        cartas), y las cuatro insignias regionales. Lo calcula el servidor con el resumen por carta.
 *   GET ?team=<id>     → el detalle de un equipo: todas sus cartas, cuáles tienes y cuántas copias.
 *
 * El usuario sale SIEMPRE del Bearer. No hay POST: aquí no se reclama ni se escribe nada.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import { getTeamCollection, getTeamCollections, type TeamCollectionsResult } from "@/server/services/teamCollections";

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
