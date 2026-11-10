/**
 * `GET /api/game/daily-loop` — DAILY GAME LOOP 2.0 (Fase 36). SOLO LECTURA.
 *
 * La foto del vestíbulo: acción principal, secundarias, «hoy», temporada, ranked, campaña, directo, sobres,
 * colección, logros, retos y equipo (`DailyLoopSnapshot`). El `userId` sale SIEMPRE del Bearer; sin sesión
 * se sirve la parte pública (temporada y eventos) con una acción «Entrar para jugar».
 *
 * No existe POST: reclamar sigue en `/api/game/progression`, abrir sobres en `/api/game/packs`, jugar en
 * `/api/game/duel`. Ningún parámetro está permitido (`?userId=` → 400). Personal → `no-store`; público →
 * caché muy corta. Errores internos → mensaje genérico, sin detalles.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import { getDailyLoop } from "@/server/services/dailyLoop";
import { parseOnboardingFlags } from "@/domain/onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const PUBLIC_SHORT = { "cache-control": "public, max-age=10, s-maxage=15" };

const unavailable = () => NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: { ...NO_STORE, ...rateHeaders(5) } });

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if ([...q.keys()].length > 0) return NextResponse.json({ error: "Parámetro no válido", code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });

  const session = await getSession(req);
  const admin = session?.admin ?? getSupabaseAdmin();
  if (!admin) return unavailable();
  const userId = session?.userId ?? null;
  if (userId) {
    const rate = await takeRate(admin, userId, "daily_loop_read");
    if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, ...rateHeaders(rate.retryAfter) } });
  }

  try {
    const r = await getDailyLoop(admin, userId, { onboardingFlags: parseOnboardingFlags(session?.appMetadata) });
    if (!r.ok || !r.data) return unavailable();
    return NextResponse.json(r.data, { status: 200, headers: userId ? NO_STORE : PUBLIC_SHORT });
  } catch (e) {
    console.error("[daily-loop]", e instanceof Error ? e.message : "error");
    if (isDependencyDown(e)) return unavailable();
    return NextResponse.json({ error: "No se pudo leer tu sesión de juego", code: "SERVER_ERROR" }, { status: 500, headers: NO_STORE });
  }
}
