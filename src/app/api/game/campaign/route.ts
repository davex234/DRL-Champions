/**
 * `/api/game/campaign` — ROAD TO CHAMPIONS (Fase 35).
 *
 *   GET                                   → `CampaignSnapshot`. Con Bearer: el mapa del usuario (no-store).
 *                                           Sin sesión: la definición como vista previa (caché pública corta).
 *   POST { action: "start", nodeId, deckId? } → lanza el nodo con el PvE canónico → `{ view, nodeId, replay }`
 *   POST { action: "sync" }               → reconcilia lo pendiente y devuelve la foto
 *   POST { action: "abandon" }            → suelta el nodo en marcha (si su partida ya terminó, la liquida)
 *
 * El cuerpo es una lista CERRADA de claves: `userId`, `difficulty`, `opponent`, `winner`, `result`, `reward`,
 * `completed`… → 400. El usuario sale SIEMPRE del token; dificultad, rival y recompensa, de la definición.
 * Un fallo interno nunca viaja crudo: 5xx → 503 genérico.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import {
  getCampaign, getCampaignDefinition, startCampaignNode, syncCampaign, abandonCampaignAttempt, type CampaignResult,
} from "@/server/services/campaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const PUBLIC_SHORT = { "cache-control": "public, max-age=60, s-maxage=300" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NODE_PARAM = /^c[0-9]{1,2}-n[0-9]{1,2}$/;
const BODY_KEYS: Record<string, readonly string[]> = {
  start: ["action", "nodeId", "deckId"],
  sync: ["action"],
  abandon: ["action"],
};

const bad = (error: string, status = 400, code = "BAD_REQUEST") => NextResponse.json({ error, code }, { status, headers: NO_STORE });

function reply<T>(r: CampaignResult<T>, headers: Record<string, string>) {
  if (!r.ok && r.status >= 500) {
    console.error("[campaign]", r.code ?? "", r.error);
    // El «todavía no disponible» es un estado de producto, no un detalle interno: se dice tal cual.
    if (r.code === "MIGRATION_PENDING" || r.code === "RIVAL_UNAVAILABLE" || r.code === "INVALID_DEFINITION") {
      return NextResponse.json({ error: r.error, code: r.code }, { status: 503, headers: rateHeaders(30) });
    }
    return NextResponse.json({ error: "Road to Champions no responde ahora mismo", code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
  }
  return NextResponse.json(r.ok ? r.data : { error: r.error, code: r.code, ...(r.extra ?? {}) }, { status: r.status, headers: r.ok ? headers : NO_STORE });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  // Sin parámetros: la foto no se filtra ni se elige desde fuera.
  if ([...q.keys()].length > 0) return bad("Parámetro no válido");

  const session = await getSession(req);
  const admin = session?.admin ?? getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });

  try {
    if (!session) return reply(await getCampaignDefinition(admin), PUBLIC_SHORT);
    const rate = await takeRate(admin, session.userId, "campaign_read");
    if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) });
    return reply(await getCampaign(admin, session.userId), NO_STORE);
  } catch (e) {
    console.error("[campaign]", e);
    if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
    return bad("Road to Champions no responde ahora mismo", 503, "UNAVAILABLE");
  }
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado", code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE });

  let body: unknown = null;
  try { body = await req.json(); } catch { return bad("Cuerpo no válido"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Cuerpo no válido");
  const b = body as Record<string, unknown>;
  const action = typeof b.action === "string" ? b.action : "";
  const allowed = BODY_KEYS[action];
  if (!allowed) return bad("Acción inválida");
  for (const key of Object.keys(b)) if (!allowed.includes(key)) return bad("Campo no permitido", 400, "FIELD_NOT_ALLOWED");

  const rate = await takeRate(session.admin, session.userId, "campaign_write");
  if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) });

  try {
    switch (action) {
      case "start": {
        const nodeId = typeof b.nodeId === "string" && NODE_PARAM.test(b.nodeId) ? b.nodeId : "";
        if (!nodeId) return bad("Nodo no válido", 400, "INVALID_NODE");
        let deckId: string | null = null;
        if (b.deckId !== undefined && b.deckId !== null) {
          if (typeof b.deckId !== "string" || !UUID.test(b.deckId)) return bad("Equipo no válido", 400, "INVALID_DECK");
          deckId = b.deckId;
        }
        return reply(await startCampaignNode(session.admin, session.userId, { nodeId, deckId }), NO_STORE);
      }
      case "sync":
        return reply(await syncCampaign(session.admin, session.userId), NO_STORE);
      case "abandon":
        return reply(await abandonCampaignAttempt(session.admin, session.userId), NO_STORE);
    }
    return bad("Acción inválida");
  } catch (e) {
    console.error("[campaign]", e);
    if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: rateHeaders(5) });
    return bad("Road to Champions no responde ahora mismo", 503, "UNAVAILABLE");
  }
}
