/**
 * `GET /api/game/meta` — META SNAPSHOT (Fase 27).
 *
 * Lectura agregada para el Meta Hub, la home y el post-partida. Solo GET: esta ruta NO concede,
 * NO completa y NO reclama nada. Reclamar sigue viviendo en `/api/game/progression`.
 *
 * El `userId` sale del token; el cuerpo no existe. `cache-control: no-store`: una lectura de XP o
 * de recompensas no puede quedarse obsoleta tras una partida.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { getMetaSnapshot } from "@/server/services/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  try {
    const r = await getMetaSnapshot(session.admin, session.userId);
    return NextResponse.json(r.ok ? r.data : { error: r.error }, { status: r.status, headers: NO_STORE });
  } catch (e) {
    console.error("[meta]", e);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500, headers: NO_STORE });
  }
}
