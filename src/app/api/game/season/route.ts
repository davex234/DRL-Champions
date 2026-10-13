/**
 * `GET /api/game/season` — TEMPORADA (Fase 34). SOLO LECTURA.
 *
 *   GET                      → `SeasonHubSnapshot` de la temporada actual (o la próxima/anterior si no hay)
 *   GET ?season=<id|slug>    → la foto de ESA temporada (archivo, resumen)
 *   GET ?scope=calendar      → solo el calendario (`SeasonCalendarSnapshot`): vestíbulo, perfil, navegación
 *
 * Con Bearer válido se añade lo PERSONAL (`userId` SIEMPRE del token); sin sesión, solo lo público.
 * No existe POST: las temporadas se escriben en `data/seasonCalendar.ts` (servidor), y los reclamos siguen
 * en `/api/game/progression`. Esta ruta no concede, no resetea y no muta nada.
 *
 * Caché: lo público, muy corta (10 s / 15 s en CDN, sin `stale-while-revalidate`) para que `serverNow`
 * no llegue viejo a la cuenta atrás; lo personal, `no-store`. Parámetros desconocidos → 400.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import { getSeasonCalendar, getSeasonHub, type SeasonResult } from "@/server/services/season";
import { SEASON_KEY } from "@/domain/season/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const PUBLIC_SHORT = { "cache-control": "public, max-age=10, s-maxage=15" };
const ALLOWED = new Set(["season", "scope"]);

const bad = (error: string, status = 400, code = "BAD_REQUEST") => NextResponse.json({ error, code }, { status, headers: NO_STORE });

function reply<T>(r: SeasonResult<T>, headers: Record<string, string>) {
  if (!r.ok && r.status >= 500) {
    console.error("[season]", r.code ?? "", r.error);
    return NextResponse.json({ error: "No se pudo leer la temporada", code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
  }
  return NextResponse.json(r.ok ? r.data : { error: r.error, code: r.code }, { status: r.status, headers: r.ok ? headers : NO_STORE });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  for (const key of q.keys()) if (!ALLOWED.has(key)) return bad("Parámetro no válido");
  const scope = q.get("scope") ?? "hub";
  if (scope !== "hub" && scope !== "calendar") return bad("Parámetro no válido");
  const seasonKey = q.get("season");
  if (seasonKey !== null && !SEASON_KEY.test(seasonKey)) return bad("Temporada no válida", 400, "INVALID_SEASON");

  // El calendario no necesita base de datos ni sesión: es público y lo resuelve el reloj del servidor.
  if (scope === "calendar") return reply(getSeasonCalendar(), PUBLIC_SHORT);

  const session = await getSession(req);
  const admin = session?.admin ?? getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
  const userId = session?.userId ?? null;
  if (userId) {
    const rate = await takeRate(admin, userId, "season_read");
    if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) });
  }

  try {
    return reply(await getSeasonHub(admin, userId, { season: seasonKey }), userId ? NO_STORE : PUBLIC_SHORT);
  } catch (e) {
    console.error("[season]", e);
    if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
    return bad("No se pudo leer la temporada", 500, "SERVER_ERROR");
  }
}
