/**
 * `/api/game/events` — EL EVENTO EN VIVO (Fase 12).
 *
 *   GET                                   → EventView | null
 *   POST { action: "claim", eventId, challengeId } → ClaimResult
 *
 * ────────────────────────── QUÉ NO ACEPTA ──────────────────────────
 *
 * Ni una cantidad, ni una recompensa, ni una fecha, ni un progreso. El cuerpo de la única
 * acción de escritura son **dos identificadores**, y los dos se validan contra el catálogo
 * del servidor antes de tocar nada. Todo lo demás —qué evento está vivo, en qué fase está,
 * cuánto llevas y cuánto vale— lo calcula `services/events`.
 *
 * Es la misma regla que la Fase 11 fijó para el desguace y el mercado: si el cliente pudiera
 * nombrar el premio, el premio lo pondría el cliente.
 *
 * `GET` es de solo lectura y `no-store`: la vista caduca en cuanto el jugador juega un duelo
 * o abre un sobre, y una lista de desafíos cacheada enseñaría progreso viejo.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { getEventView, claimEventChallenge } from "@/server/services/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** Identificadores: cortos, sin espacios y sin nada que pueda viajar a una consulta. */
const ID = /^[\w:-]{1,128}$/;

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }
  try {
    const res = await getEventView(session.admin, session.userId);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status, headers: NO_STORE });
    return NextResponse.json(res.data ?? null, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo leer el evento" },
      { status: 500, headers: NO_STORE },
    );
  }
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }

  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  const b = (body ?? {}) as Record<string, unknown>;

  if (b.action !== "claim") {
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400, headers: NO_STORE });
  }

  const eventId = typeof b.eventId === "string" ? b.eventId : "";
  const challengeId = typeof b.challengeId === "string" ? b.challengeId : "";
  if (!ID.test(eventId) || !ID.test(challengeId)) {
    return NextResponse.json({ error: "Identificador inválido" }, { status: 400, headers: NO_STORE });
  }

  try {
    const res = await claimEventChallenge(session.admin, session.userId, eventId, challengeId);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status, headers: NO_STORE });
    return NextResponse.json(res.data, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo reclamar" },
      { status: 500, headers: NO_STORE },
    );
  }
}
