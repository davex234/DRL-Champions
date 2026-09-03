/**
 * `/api/game/economy` — OPERACIONES ECONÓMICAS DEL JUGADOR (Fase 11).
 *
 *   POST { action: "salvagePreview" }                  → qué duplicados tienes y cuánto valen
 *   POST { action: "salvage", uids: string[], ref }    → desguazarlos
 *
 * ────────────────────────── LAS DOS REGLAS ──────────────────────────
 *
 * **1. El cliente nombra cartas; el servidor pone precio.** El cuerpo NO admite ningún
 * importe. Si lo llevara, alguien podría desguazar una común por 900.000 créditos. El
 * total lo calcula `services/economy` con la tabla del dominio y lo cierra antes de tocar
 * la base de datos.
 *
 * **2. Toda operación que mueve saldo lleva clave.** `ref` es el gesto del cliente y el
 * servidor lo convierte en la clave de idempotencia. Reintentar el mismo gesto devuelve el
 * mismo resultado en lugar de cobrar —o borrar cartas— dos veces.
 *
 * El usuario sale SIEMPRE del token, nunca del cuerpo.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { previewSalvage, salvageCards } from "@/server/services/economy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** Un uuid de `user_cards.uid`. Nada que no tenga esta forma llega al servicio. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GESTURE = /^[\w:-]{1,128}$/;

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* cuerpo vacío */ }

  const action = typeof body.action === "string" ? body.action : "";

  try {
    switch (action) {
      case "salvagePreview": {
        const r = await previewSalvage(session.admin, session.userId);
        return r.ok
          ? NextResponse.json(r.data, { headers: NO_STORE })
          : NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });
      }

      case "salvage": {
        /*
         * La lista se acota ANTES de llegar al servicio: forma de uuid, sin repetidos y
         * con techo. Un cuerpo con cien mil elementos no debe llegar a construir una
         * consulta.
         */
        const raw = Array.isArray(body.uids) ? body.uids : [];
        const uids = [...new Set(raw.filter((u): u is string => typeof u === "string" && UUID.test(u)))];
        if (uids.length === 0) {
          return NextResponse.json({ error: "No has elegido ninguna carta" }, { status: 400, headers: NO_STORE });
        }
        if (uids.length > 500) {
          return NextResponse.json({ error: "Demasiadas cartas en una sola operación" }, { status: 400, headers: NO_STORE });
        }

        const gesture = typeof body.ref === "string" && GESTURE.test(body.ref) ? body.ref : null;
        if (!gesture) {
          return NextResponse.json({ error: "Falta la clave de la operación" }, { status: 400, headers: NO_STORE });
        }

        const r = await salvageCards(
          session.admin, session.userId, uids, `salvage:${session.userId}:${gesture}`,
        );
        return r.ok
          ? NextResponse.json(r.data, { headers: NO_STORE })
          : NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });
      }

      default:
        return NextResponse.json({ error: "Acción inválida" }, { status: 400, headers: NO_STORE });
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error en la operación" },
      { status: 500, headers: NO_STORE },
    );
  }
}
