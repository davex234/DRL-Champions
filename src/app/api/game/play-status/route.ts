/**
 * `GET /api/game/play-status` — FASE 44 · ¿JUGAR o CONTINUAR PARTIDA? SOLO LECTURA.
 *
 * Lo consulta el armazón para decidir el texto del botón global. El `userId` sale SIEMPRE del Bearer; sin sesión
 * no hay nada que retomar (`resume: null`, sin tocar la base). Ningún parámetro permitido. Comparte la cubeta de
 * lectura del Daily Loop (misma familia de lectura, sin migración). Errores → respuesta neutra, nunca el mensaje interno.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { takeRate, rateHeaders, TOO_MANY } from "@/server/services/rateLimit";
import { getPlayStatus } from "@/server/services/playStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if ([...q.keys()].length > 0) return NextResponse.json({ error: "Parámetro no válido", code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });

  const session = await getSession(req);
  if (!session) return NextResponse.json({ serverNow: Date.now(), resume: null, unknown: false }, { status: 200, headers: NO_STORE });

  const rate = await takeRate(session.admin, session.userId, "daily_loop_read");
  if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, ...rateHeaders(rate.retryAfter) } });

  const status = await getPlayStatus(session.admin, session.userId);
  return NextResponse.json(status, { status: 200, headers: NO_STORE });
}
