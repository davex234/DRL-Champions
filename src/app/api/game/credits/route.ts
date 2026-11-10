/**
 * `/api/game/credits` — DRL CREDITS del jugador (Fase 18).
 *
 *   GET                                               → saldo · catálogo · historial
 *   POST { action: "sandboxPurchase", productId, ref } → conceder DRL Credits (PRUEBA)
 *   POST { action: "sandboxRefund", purchaseRef, ref } → devolver una compra de prueba
 *
 * ────────────────────────── LAS TRES REGLAS ──────────────────────────
 *
 * **1. El cuerpo NO lleva ni un número económico.** Ni `credits`, ni `amount`, ni
 * `balance`, ni `delta`. El cliente nombra un PRODUCTO y el catálogo del servidor dice
 * cuánto concede. Si el cuerpo trae un campo económico, la petición se **rechaza** en vez
 * de ignorarlo en silencio: quien lo envía está probando, y conviene que lo sepa.
 *
 * **2. El usuario sale del token.** Nunca del cuerpo. No hay parámetro `userId` en ninguna
 * de las tres operaciones, así que no existe la petición «dame el historial de otro».
 *
 * **3. Aquí no se cobra.** `PAYMENTS_ENABLED` sigue en falso y no hay pasarela. Toda
 * respuesta lleva `sandbox: true` para que la interfaz no pueda escribir «pago completado»
 * sin mentir.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { getCredits, sandboxPurchase, sandboxRefund } from "@/server/services/credits";
import { takeRate, rateHeaders, TOO_MANY } from "@/server/services/rateLimit";
import { internalError } from "@/server/ops/log";
import { readJsonObject } from "@/server/http/jsonBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** Gesto del cliente: identificador corto y sin sorpresas. Se convierte en clave de idempotencia. */
const GESTURE = /^[\w:-]{1,128}$/;
const PRODUCT = /^[a-z0-9-]{1,64}$/;

/**
 * Campos que un cliente NO puede enviar en una operación económica. Están aquí por su
 * nombre porque el ataque clásico es exactamente ese: colar `credits: 999999` y confiar en
 * que alguien lo lea.
 */
const FORBIDDEN = ["credits", "amount", "balance", "delta", "price", "cents",
  "kind", "transactionType", "userId", "user_id", "balanceAfter"];

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }
  const res = await getCredits(session.admin, session.userId);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.status, headers: NO_STORE });
  }
  return NextResponse.json(res.data, { headers: NO_STORE });
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }
  // F67 · límite de frecuencia de las escrituras de esta ruta (cubeta en BD: vale con varios procesos).
  { const rate = await takeRate(session.admin, session.userId, "economy_write"); if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) }); }

  let body: Record<string, unknown> = {};
  body = ((await readJsonObject(req)) ?? {}) as typeof body; // FULL GAME AUDIT · `null`/no-objeto ya no da 500

  const intruso = FORBIDDEN.find((k) => k in body);
  if (intruso) {
    return NextResponse.json(
      { error: `El cliente no decide «${intruso}»` }, { status: 400, headers: NO_STORE },
    );
  }

  const action = typeof body.action === "string" ? body.action : "";
  const ref = typeof body.ref === "string" ? body.ref : "";
  if (!GESTURE.test(ref)) {
    return NextResponse.json({ error: "Referencia inválida" }, { status: 400, headers: NO_STORE });
  }

  try {
    switch (action) {
      case "sandboxPurchase": {
        const productId = typeof body.productId === "string" ? body.productId : "";
        if (!PRODUCT.test(productId)) {
          return NextResponse.json({ error: "Producto inválido" }, { status: 400, headers: NO_STORE });
        }
        const res = await sandboxPurchase(session.admin, session.userId, productId, ref);
        if (!res.ok) {
          return NextResponse.json({ error: res.error }, { status: res.status, headers: NO_STORE });
        }
        return NextResponse.json(res.data, { headers: NO_STORE });
      }
      case "sandboxRefund": {
        const purchaseRef = typeof body.purchaseRef === "string" ? body.purchaseRef : "";
        if (!GESTURE.test(purchaseRef)) {
          return NextResponse.json({ error: "Compra original inválida" }, { status: 400, headers: NO_STORE });
        }
        const res = await sandboxRefund(session.admin, session.userId, purchaseRef, ref);
        if (!res.ok) {
          return NextResponse.json({ error: res.error }, { status: res.status, headers: NO_STORE });
        }
        return NextResponse.json(res.data, { headers: NO_STORE });
      }
      default:
        return NextResponse.json({ error: "Acción desconocida" }, { status: 400, headers: NO_STORE });
    }
  } catch (e) {
    return internalError("api/game/credits", e, req);
  }
}
