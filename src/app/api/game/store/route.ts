/**
 * POST /api/game/store — checkout de la Tienda 4.0 (Fase 49).
 *
 *   { "action": "checkout", "productId": "pack:premium", "method": "GAME_CURRENCY", "ref": "<gesto>" }
 *
 * El cliente solo NOMBRA el producto y el método. Precio, cantidad, cartas y contenido los resuelve el
 * servidor (`storeCheckout`). Cualquier otro campo se rechaza —en particular los económicos—, en vez de
 * ignorarlo en silencio. Requiere `Authorization: Bearer <access_token>`; el usuario sale del token.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { ensureServerPacks } from "@/server/cms/packs";
import { storeCheckout } from "@/server/services/store";
import { PRODUCT_ID } from "@/domain/store/resolve";
import { takeRate, rateHeaders, TOO_MANY } from "@/server/services/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 1_000;
const ALLOWED = ["action", "productId", "method", "ref"];
const METHODS = new Set(["GAME_CURRENCY", "REAL_MONEY"]);
const GENERIC = "No se pudo completar la operación";
const NO_STORE = { "cache-control": "no-store" };

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  // F67 · límite de frecuencia de las escrituras de esta ruta (cubeta en BD: vale con varios procesos).
  { const rate = await takeRate(session.admin, session.userId, "economy_write"); if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) }); }
  await ensureServerPacks(session.admin); // F60: ofertas de los sobres del panel

  let raw = "";
  try { raw = await req.text(); } catch { /* cuerpo ilegible */ }
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Cuerpo demasiado grande" }, { status: 413, headers: NO_STORE });
  let body: Record<string, unknown> = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* no JSON */ }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
  // Precio, cantidad, cartas, contenido de caja, usuario…: nada de eso lo decide el navegador.
  if (Object.keys(body).some((k) => !ALLOWED.includes(k))) {
    return NextResponse.json({ error: "Campo no permitido" }, { status: 400, headers: NO_STORE });
  }
  if (body.action !== "checkout") return NextResponse.json({ error: "Acción inválida" }, { status: 400, headers: NO_STORE });
  const productId = typeof body.productId === "string" ? body.productId : "";
  if (!PRODUCT_ID.test(productId)) return NextResponse.json({ error: "Producto inválido" }, { status: 400, headers: NO_STORE });
  const method = typeof body.method === "string" && METHODS.has(body.method) ? (body.method as "GAME_CURRENCY" | "REAL_MONEY") : null;
  if (!method) return NextResponse.json({ error: "Método de pago inválido" }, { status: 400, headers: NO_STORE });
  const ref = typeof body.ref === "string" && /^[\w:-]{1,128}$/.test(body.ref) ? body.ref : undefined;

  try {
    const result = await storeCheckout(session.admin, session.userId, { productId, method, ref });
    if (!result.ok) {
      if (result.status >= 500 && result.status !== 503) {
        console.error("[store]", result.error);
        return NextResponse.json({ error: GENERIC }, { status: result.status, headers: NO_STORE });
      }
      return NextResponse.json({ error: result.error }, { status: result.status, headers: NO_STORE });
    }
    return NextResponse.json(result.data, { headers: NO_STORE });
  } catch (e) {
    console.error("[store]", e instanceof Error ? e.message : "error");
    return NextResponse.json({ error: GENERIC }, { status: 500, headers: NO_STORE });
  }
}
