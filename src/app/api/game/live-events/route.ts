/**
 * `GET /api/game/live-events` — LIVE EVENTS 1.0 (Fase 30). SOLO LECTURA.
 *
 *   GET                 → `EventsOverviewSnapshot` (en curso · próximamente · finalizados · principal)
 *   GET ?event=<id>     → `EventHubSnapshot` (estado, partidos, cuadro, equipos, jugadores, cartas, Pick'em, objetivos, acciones)
 *   GET ?match=<id>     → `EventMatchSnapshot` (mapas, marcadores, estadísticas, predicción relacionada)
 *   GET ?badge=1        → partidos EN DIRECTO reales ahora mismo (para la navegación)
 *
 * Los datos del evento son públicos (misma política que las tablas del pipeline, legibles bajo
 * RLS); lo PERSONAL (predicciones, propiedad, objetivos) solo viaja con un Bearer válido, y el
 * `userId` sale siempre del token. No existe POST: nada aquí escribe partidos, resultados,
 * predicciones ni recompensas (las predicciones van por `/api/pickems`; los desafíos por
 * `/api/game/events`). La frescura del worker se resume en una frase, nunca en sus internos.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import { getEventsOverview, getEventHub, getEventMatch, getLiveCount, type LiveResult } from "@/server/services/liveEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
/** Datos del evento: caché corta y compartida (el worker corre cada 2 min). Nunca con sesión. */
const PUBLIC_SHORT = { "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60" };
const ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]|:){0,63}$/;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: NO_STORE });
/** Un fallo del backend nunca viaja crudo: se registra y se responde 503 con la frase del producto. */
const reply = <T,>(r: LiveResult<T>, headers: Record<string, string>) => {
  if (!r.ok && r.status >= 500) {
    console.error("[live-events]", r.error);
    return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
  }
  return NextResponse.json(r.ok ? r.data : { error: r.error, code: r.code }, { status: r.status, headers: r.ok ? headers : NO_STORE });
};

export async function GET(req: Request) {
  const session = await getSession(req);
  const admin = session?.admin ?? getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
  const userId = session?.userId ?? null;
  const q = new URL(req.url).searchParams;

  // Con sesión el sujeto del contador es el usuario del Bearer; sin sesión los datos son públicos
  // y equivalentes a leer las tablas bajo RLS, así que no hay contador que proteger.
  if (userId) {
    const rate = await takeRate(admin, userId, "events_read");
    if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) });
  }
  const headers = userId ? NO_STORE : PUBLIC_SHORT;

  try {
    if (q.has("badge")) return reply(await getLiveCount(admin), headers);
    if (q.has("event")) {
      const id = q.get("event") ?? "";
      if (!ID.test(id)) return bad("Evento no válido");
      return reply(await getEventHub(admin, userId, id), headers);
    }
    if (q.has("match")) {
      const id = q.get("match") ?? "";
      if (!ID.test(id)) return bad("Partido no válido");
      return reply(await getEventMatch(admin, userId, id), headers);
    }
    return reply(await getEventsOverview(admin, userId), headers);
  } catch (e) {
    console.error("[live-events]", e);
    if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
    return bad("Error de servidor", 500);
  }
}
