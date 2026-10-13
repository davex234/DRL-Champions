/**
 * `GET /api/game/starter` — ASISTENCIA DE PRIMER EQUIPO (Fase 41). SOLO LECTURA.
 *
 * Dice si el servidor concedería AHORA un Sobre Inicial gratis y, si no, por qué (plantilla ya posible, Sobre Inicial
 * sin abrir o tope de concesiones), con los roles que faltan. No existe POST: la concesión va por la compra normal
 * (`POST /api/game/packs`), que vuelve a comprobarlo todo en el servidor. El `userId` sale del token.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { readStarterStatus } from "@/server/services/starter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  try {
    return NextResponse.json(await readStarterStatus(session.admin, session.userId), { headers: NO_STORE });
  } catch (e) {
    console.error("[starter]", e instanceof Error ? e.message : "error");
    return NextResponse.json({ error: "No se pudo comprobar el Sobre Inicial" }, { status: 500, headers: NO_STORE });
  }
}
