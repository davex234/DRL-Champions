/**
 * GET /api/game/state — estado de juego REAL del usuario autenticado.
 *
 * Fuente de verdad: tablas `user_cards`, `user_packs`, `user_game`, `profiles`
 * (migración 0011). Sustituye a `localStorage` como autoridad; el cliente lo usa
 * como caché de UI.
 *
 * Requiere `Authorization: Bearer <access_token>` de Supabase Auth. El `userId`
 * se deriva del token, nunca del cuerpo.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { loadGameState } from "@/server/services/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    const state = await loadGameState(session.admin, session.userId);
    return NextResponse.json(state, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error al cargar el estado" },
      { status: 500 },
    );
  }
}
