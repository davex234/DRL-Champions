/**
 * `/api/game/economy` — OPERACIONES ECONÓMICAS DEL JUGADOR (Fase 11).
 *
 *   POST { action: "salvagePreview" }                  → qué duplicados tienes y cuánto valen
 *   POST { action: "salvage", uids: string[], ref, confirmProtected? } → desguazarlos (F79.1: protegidas solo confirmadas)
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
import { takeRate, rateHeaders, TOO_MANY } from "@/server/services/rateLimit";
import { internalError } from "@/server/ops/log";
import { readJsonObject } from "@/server/http/jsonBody";

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
  // F67 · límite de frecuencia de las escrituras de esta ruta (cubeta en BD: vale con varios procesos).
  { const rate = await takeRate(session.admin, session.userId, "economy_write"); if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) }); }

  let body: Record<string, unknown> = {};
  body = ((await readJsonObject(req)) ?? {}) as typeof body; // FULL GAME AUDIT · `null`/no-objeto ya no da 500

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

        // F79.1 · copias protegidas (favorita/vitrina) que el jugador CONFIRMA desguazar. Solo restringe: una protegida
        // elegida sin estar aquí rechaza el desguace entero (PROTECTED_COPY).
        const rawConfirm = body.confirmProtected === undefined ? [] : body.confirmProtected;
        if (!Array.isArray(rawConfirm) || rawConfirm.length > 500 || !rawConfirm.every((u) => typeof u === "string" && UUID.test(u))) {
          return NextResponse.json({ error: "Confirmación inválida" }, { status: 400, headers: NO_STORE });
        }

        const r = await salvageCards(
          session.admin, session.userId, uids, `salvage:${session.userId}:${gesture}`, rawConfirm as string[],
        );
        return r.ok
          ? NextResponse.json(r.data, { headers: NO_STORE })
          : NextResponse.json({ error: r.error, ...(r.code ? { code: r.code } : {}) }, { status: r.status, headers: NO_STORE });
      }

      default:
        return NextResponse.json({ error: "Acción inválida" }, { status: 400, headers: NO_STORE });
    }
  } catch (e) {
    return internalError("api/game/economy", e, req);
  }
}
