/**
 * `/api/game/onboarding` — ONBOARDING 5.0 (Fase 63).
 *
 *   GET  → `OnboardingView`: estado (NOT_STARTED / IN_PROGRESS / COMPLETED), paso actual «X/6», siguiente acción y los
 *          recursos reales de la cuenta. SOLO LECTURA.
 *   POST { action: "start" | "skip" | "resume" | "finish" | "first-team" } → `{ onboarding, team? }`
 *
 * El `userId` sale SIEMPRE del Bearer. El cuerpo es estricto (una sola clave). Ninguna orden concede créditos, sobres ni
 * XP: el starter lo concedió el alta (`handle_new_user`, una vez por cuenta) y `first-team` solo ordena cartas que ya son
 * del jugador. `finish` exige una partida terminada en la base de datos. Errores internos → mensaje genérico.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import { authFlagStore, readOnboarding, runOnboardingCommand } from "@/server/services/onboarding";
import { parseOnboardingFlags, parseOnboardingRequest } from "@/domain/onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const unavailable = () => NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: { ...NO_STORE, ...rateHeaders(5) } });

export async function GET(req: Request) {
  if ([...new URL(req.url).searchParams.keys()].length > 0) {
    return NextResponse.json({ error: "Parámetro no válido", code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
  }
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  const rate = await takeRate(session.admin, session.userId, "onboarding_read");
  if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, ...rateHeaders(rate.retryAfter) } });
  try {
    const view = await readOnboarding(session.admin, session.userId, parseOnboardingFlags(session.appMetadata));
    return NextResponse.json(view, { headers: NO_STORE });
  } catch (e) {
    console.error("[onboarding]", e instanceof Error ? e.message : "error");
    return isDependencyDown(e) ? unavailable() : NextResponse.json({ error: "No se pudo leer tu inicio", code: "SERVER_ERROR" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  const rate = await takeRate(session.admin, session.userId, "onboarding_write");
  if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, ...rateHeaders(rate.retryAfter) } });
  let body: unknown = null;
  try { body = await req.json(); } catch { body = null; }
  const parsed = parseOnboardingRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
  try {
    const r = await runOnboardingCommand(session.admin, session.userId, parsed.command, authFlagStore(session.admin));
    if (!r.ok) {
      if (r.status >= 500) { console.error("[onboarding]", r.error); return unavailable(); }
      return NextResponse.json({ error: r.error, code: r.code, onboarding: r.onboarding, shortages: r.team?.shortages }, { status: r.status, headers: NO_STORE });
    }
    return NextResponse.json({ onboarding: r.onboarding, team: r.team ? { deck: r.team.deck, created: r.team.created, activated: r.team.activated } : undefined, changed: r.changed }, { headers: NO_STORE });
  } catch (e) {
    console.error("[onboarding]", e instanceof Error ? e.message : "error");
    return isDependencyDown(e) ? unavailable() : NextResponse.json({ error: "No se pudo guardar tu inicio", code: "SERVER_ERROR" }, { status: 500, headers: NO_STORE });
  }
}
