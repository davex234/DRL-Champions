/**
 * `/api/game/draft-gauntlet` — DRAFT GAUNTLET (Fase 39).
 *
 *   GET                                                              → `DraftSnapshot` del usuario (no-store)
 *   POST { action: "start",       actionId }                         → crea la run (o devuelve la activa)
 *   POST { action: "pick",        actionId, expectedVersion, choiceId } → UNA elección de la oferta actual
 *   POST { action: "start_match", actionId, expectedVersion }        → lanza (o devuelve) el combate de la etapa
 *   POST { action: "abandon",     actionId, expectedVersion, confirm: true } → termina la run como ABANDONED
 *
 * El cuerpo es una lista CERRADA de claves y ≤ 1 KB: `userId`, `seed`, `stage`, `won`, `result`, `cards`, `deck`,
 * `difficulty`, `reward`… → 400. El usuario sale SIEMPRE del token. Un fallo interno nunca viaja crudo: 5xx → 503.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import {
  getDraftGauntlet, startDraftRun, pickDraftCard, startDraftStage, abandonDraftRun, type DraftResult,
} from "@/server/services/draftGauntlet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
export const MAX_BODY = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Id público de carta del catálogo: `jugador__variante`. */
export const CARD_ID = /^[a-z0-9][a-z0-9_-]{0,63}__[a-z0-9][a-z0-9_-]{0,31}$/i;
export const BODY_KEYS: Record<string, readonly string[]> = {
  start: ["action", "actionId"],
  pick: ["action", "actionId", "expectedVersion", "choiceId"],
  start_match: ["action", "actionId", "expectedVersion"],
  abandon: ["action", "actionId", "expectedVersion", "confirm"],
};
const GENERIC = "Draft Gauntlet no responde ahora mismo";

const bad = (error: string, status = 400, code = "BAD_REQUEST") => NextResponse.json({ error, code }, { status, headers: NO_STORE });

function reply<T>(r: DraftResult<T>) {
  if (!r.ok && r.status >= 500) {
    console.error("[draft]", r.code ?? "", r.error);
    if (r.code === "MIGRATION_PENDING" || r.code === "POOL_UNAVAILABLE") {
      return NextResponse.json({ error: r.error, code: r.code }, { status: 503, headers: rateHeaders(30) });
    }
    return NextResponse.json({ error: GENERIC, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
  }
  if (r.ok) return NextResponse.json(r.data, { status: 200, headers: NO_STORE });
  return NextResponse.json({ error: r.error, code: r.code, ...(r.reason ? { reason: r.reason } : {}), ...(r.snapshot ? { snapshot: r.snapshot } : {}) }, { status: r.status, headers: NO_STORE });
}

function down(e: unknown) {
  console.error("[draft]", e);
  if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
  return bad(GENERIC, 503, "UNAVAILABLE");
}

export async function GET(req: Request) {
  if ([...new URL(req.url).searchParams.keys()].length > 0) return bad("Parámetro no válido");
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado", code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE });
  try {
    const rate = await takeRate(session.admin, session.userId, "draft_read");
    if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) });
    return reply(await getDraftGauntlet(session.admin, session.userId));
  } catch (e) {
    return down(e);
  }
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado", code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE });

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return bad("Cuerpo demasiado grande", 413, "BODY_TOO_LARGE");
  let text = "";
  try { text = await req.text(); } catch { return bad("Cuerpo no válido"); }
  if (text.length > MAX_BODY) return bad("Cuerpo demasiado grande", 413, "BODY_TOO_LARGE");
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { return bad("Cuerpo no válido"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Cuerpo no válido");
  const b = body as Record<string, unknown>;
  const action = typeof b.action === "string" ? b.action : "";
  const allowed = Object.prototype.hasOwnProperty.call(BODY_KEYS, action) ? BODY_KEYS[action] : null;
  if (!allowed) return bad("Acción inválida");
  for (const key of Object.keys(b)) if (!allowed.includes(key)) return bad("Campo no permitido", 400, "FIELD_NOT_ALLOWED");

  const actionId = typeof b.actionId === "string" && UUID.test(b.actionId) ? b.actionId : "";
  if (!actionId) return bad("Acción sin identificador válido", 400, "INVALID_ACTION_ID");
  let expectedVersion = 0;
  if (action !== "start") {
    if (typeof b.expectedVersion !== "number" || !Number.isInteger(b.expectedVersion) || b.expectedVersion < 1 || b.expectedVersion > 1_000_000) {
      return bad("Versión no válida", 400, "INVALID_VERSION");
    }
    expectedVersion = b.expectedVersion;
  }

  const rate = await takeRate(session.admin, session.userId, "draft_write");
  if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) });

  try {
    switch (action) {
      case "start":
        return reply(await startDraftRun(session.admin, session.userId, { actionId }));
      case "pick": {
        const choiceId = typeof b.choiceId === "string" && CARD_ID.test(b.choiceId) ? b.choiceId : "";
        if (!choiceId) return bad("Elección no válida", 400, "INVALID_CHOICE");
        return reply(await pickDraftCard(session.admin, session.userId, { actionId, expectedVersion, choiceId }));
      }
      case "start_match":
        return reply(await startDraftStage(session.admin, session.userId, { actionId, expectedVersion }));
      case "abandon":
        if (b.confirm !== true) return bad("Confirma el abandono", 400, "CONFIRM_REQUIRED");
        return reply(await abandonDraftRun(session.admin, session.userId, { actionId, expectedVersion }));
    }
    return bad("Acción inválida");
  } catch (e) {
    return down(e);
  }
}
