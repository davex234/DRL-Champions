/**
 * `/api/game/feedback` — F86.2 · feedback de la Closed Alpha.
 *
 *   POST { action: "submit", id, source?, hardToUnderstand?, lostMoment?, likedMost?, likedLeast?, hadError?,
 *          errorDetail?, wouldReturn?, comment? }  → { code: "SAVED" | "ALREADY", id }
 *
 * Solo con sesión. Lista blanca de campos (un `userId`, una fecha o un adjunto = 400). Sin GET: un jugador no lee
 * feedback (ni el suyo ni el de nadie); lo ve un administrador en /admin/alpha.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import { submitFeedback } from "@/server/services/alphaFeedback";
import { parseFeedback } from "@/domain/feedback/alpha";
import { safeServerMessage } from "@/server/ops/log";
import { APP_VERSION } from "@/platform/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const bad = (error: string, status = 400, code?: string) => NextResponse.json(code ? { error, code } : { error }, { status, headers: NO_STORE });

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return bad("No autenticado", 401);
  let body: unknown;
  try { body = await req.json(); } catch { return bad("Cuerpo no válido"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Cuerpo no válido");
  if ((body as { action?: unknown }).action !== "submit") return bad("Acción no válida");
  const parsed = parseFeedback(body);
  if (!parsed.ok) return bad(parsed.error, 400, parsed.code);
  const rate = await takeRate(session.admin, session.userId, "feedback_write");
  if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) });
  try {
    const r = await submitFeedback(session.admin, session.userId, parsed.value, APP_VERSION);
    return NextResponse.json(r.ok ? r.data : { ...safeServerMessage("api/game/feedback", r.status, r.error), code: r.code }, { status: r.status, headers: NO_STORE });
  } catch (e) {
    console.error("[feedback]", e);
    if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
    return bad("Error de servidor", 500);
  }
}
