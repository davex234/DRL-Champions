/**
 * `/api/game/mastery` — MAESTRÍA DE COLECCIÓN (Fase 13).
 *
 *   GET                                    → MasteryView
 *   POST { action: "claim", setId, at }    → MasteryClaimResult
 *
 * El cuerpo de la única escritura son **un identificador y una fracción**. Ni cantidades,
 * ni recompensas, ni progreso: qué conjuntos existen, cuánto llevas y qué se paga lo decide
 * `services/mastery` contra `user_cards`.
 *
 * `at` es la fracción del escalón (0,5 · 1 · 0,25…). Se valida como número entre 0 y 1 y
 * después se busca en el conjunto: un valor que no corresponda a ningún escalón real
 * devuelve 404 en lugar de acercarse al más próximo, que sería regalar escalones.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { getMastery, claimMasteryTier } from "@/server/services/mastery";
import { takeRate, rateHeaders, TOO_MANY } from "@/server/services/rateLimit";
import { internalError } from "@/server/ops/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const SET_ID = /^[\w:-]{1,128}$/;

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }
  try {
    const res = await getMastery(session.admin, session.userId);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status, headers: NO_STORE });
    return NextResponse.json(res.data, { headers: NO_STORE });
  } catch (e) {
    return internalError("api/game/mastery", e, req);
  }
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }
  // F67 · límite de frecuencia de las escrituras de esta ruta (cubeta en BD: vale con varios procesos).
  { const rate = await takeRate(session.admin, session.userId, "economy_write"); if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) }); }

  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  const b = (body ?? {}) as Record<string, unknown>;

  if (b.action !== "claim") {
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400, headers: NO_STORE });
  }

  const setId = typeof b.setId === "string" ? b.setId : "";
  const at = typeof b.at === "number" ? b.at : NaN;
  if (!SET_ID.test(setId) || !Number.isFinite(at) || at <= 0 || at > 1) {
    return NextResponse.json({ error: "Identificador inválido" }, { status: 400, headers: NO_STORE });
  }

  try {
    const res = await claimMasteryTier(session.admin, session.userId, setId, at);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status, headers: NO_STORE });
    return NextResponse.json(res.data, { headers: NO_STORE });
  } catch (e) {
    return internalError("api/game/mastery", e, req);
  }
}
