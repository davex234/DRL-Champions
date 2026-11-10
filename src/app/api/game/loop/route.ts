/**
 * `/api/game/loop` — EL CICLO DE JUEGO (Fase 10).
 *
 *   GET  → LoopView
 *
 * Devuelve, en una sola lectura, lo que un jugador puede hacer AHORA: la partida a
 * medias, las predicciones que caducan, lo que tiene sin reclamar, los sobres sin abrir,
 * si le falta mazo y qué está pasando en el circuito. Más su estado de rango.
 *
 * ¿Por qué una ruta nueva y no una acción más de `/api/game/progression`?
 *   Porque el ciclo es MÁS ANCHO que la progresión: cruza duelos, sobres, mazos,
 *   Pick'ems y torneos. Meterlo en la ruta del pase habría hecho que la ruta del pase
 *   dependiera de la mitad del producto. Es de solo lectura y no acepta cuerpo, así que
 *   su superficie de ataque es la mínima.
 *
 * Es GET a propósito: no muta nada. `no-store` porque la respuesta caduca en cuanto el
 * jugador hace cualquier cosa, y una tira de acciones cacheada es peor que no tenerla.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { getLoop } from "@/server/services/loop";
import { internalError } from "@/server/ops/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }

  try {
    const view = await getLoop(session.admin, session.userId);
    return NextResponse.json(view, { headers: NO_STORE });
  } catch (e) {
    return internalError("api/game/loop", e, req);
  }
}
