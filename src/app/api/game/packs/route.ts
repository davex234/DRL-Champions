/**
 * POST /api/game/packs — comprar y/o abrir sobres (bloque D).
 *
 *   { "action": "buy",          "packId": "estandar" }
 *   { "action": "open",         "packId": "estandar" }
 *   { "action": "buy_and_open", "packId": "estandar" }
 *
 * Todo ocurre en servidor: el precio sale del catálogo, la tirada la decide
 * `openPack()` en Node con semilla criptográfica, y la persistencia es atómica.
 * El cliente solo pide la operación y reproduce la animación con el resultado.
 *
 * Requiere `Authorization: Bearer <access_token>`. El usuario sale del token.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { buyPack, openPackForUser, buyAndOpen } from "@/server/services/packs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set(["buy", "open", "buy_and_open"]);

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: { action?: unknown; packId?: unknown; ref?: unknown } = {};
  try { body = await req.json(); } catch { /* cuerpo vacío */ }

  // Validación de entrada en servidor: nunca se confía en la forma del cuerpo.
  const action = typeof body.action === "string" ? body.action : "";
  const packId = typeof body.packId === "string" ? body.packId.trim() : "";
  /*
   * `ref` es el GESTO del cliente, no la clave final: el servidor la compone con el
   * usuario y la acción (`packOpRef`). Así, dos jugadores que envíen el mismo
   * identificador no colisionan en `economy_ops`, cuya clave primaria es global.
   */
  const ref = typeof body.ref === "string" && /^[\w:-]{1,128}$/.test(body.ref) ? body.ref : undefined;

  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }
  if (!packId || !/^[\w-]{1,64}$/.test(packId)) {
    return NextResponse.json({ error: "Sobre inválido" }, { status: 400 });
  }

  try {
    const result =
      action === "buy" ? await buyPack(session.admin, session.userId, packId, ref)
      : action === "open" ? await openPackForUser(session.admin, session.userId, packId)
      : await buyAndOpen(session.admin, session.userId, packId, ref);

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error en la operación" },
      { status: 500 },
    );
  }
}
