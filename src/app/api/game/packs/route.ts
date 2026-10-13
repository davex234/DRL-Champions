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
import { validExpectedPrice } from "@/domain/packs/priceConfirm";
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { ensureServerPacks } from "@/server/cms/packs";
import { buyPack, openPackForUser, buyAndOpen, packOpRef } from "@/server/services/packs";
import { settleMissionsForOp } from "@/server/services/missionEngine";
import { takeRate, rateHeaders, TOO_MANY } from "@/server/services/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set(["buy", "open", "buy_and_open"]);
/** Fase 38 · el cuerpo legítimo mide ~80 bytes; nada más grande entra. */
const MAX_BODY = 2_000;
const ALLOWED = ["action", "packId", "ref", "expectedPrice"];
const GENERIC = "No se pudo completar la operación";

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // F67 · límite de frecuencia de las escrituras de esta ruta (cubeta en BD: vale con varios procesos).
  { const rate = await takeRate(session.admin, session.userId, "economy_write"); if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) }); }
  await ensureServerPacks(session.admin); // F60: sobres del panel (ACTIVE/RETIRED) visibles para comprar/abrir

  let body: { action?: unknown; packId?: unknown; ref?: unknown; expectedPrice?: unknown } = {};
  let raw = "";
  try { raw = await req.text(); } catch { /* cuerpo ilegible */ }
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Cuerpo demasiado grande" }, { status: 413 });
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* cuerpo vacío o no JSON */ }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
  // Fase 38 · el cliente no elige cartas, rareza, serial, versión, pool ni odds: cualquier otro campo se rechaza.
  if (Object.keys(body).some((k) => !ALLOWED.includes(k))) {
    return NextResponse.json({ error: "Campo no permitido" }, { status: 400 });
  }

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
  // ICON (2026-10-09) · el precio que el jugador VIO (no decide el cobro: solo lo bloquea si no coincide).
  if (!validExpectedPrice(body.expectedPrice) || (action === "open" && body.expectedPrice !== undefined)) {
    return NextResponse.json({ error: "Precio inválido" }, { status: 400 });
  }
  const priceOpts = { expectedPrice: body.expectedPrice as number | undefined };

  try {
    const result =
      action === "buy" ? await buyPack(session.admin, session.userId, packId, ref, undefined, priceOpts)
      /*
       * Fase 25 · el `ref` TAMBIÉN viaja en `open`. Sin él, un reintento de la misma apertura
       * (respuesta perdida, doble toque) fabricaba un gesto nuevo en el servidor y consumía un
       * SEGUNDO sobre. Con él, `economy_ops` devuelve el resultado ya guardado.
       */
      : action === "open" ? await openPackForUser(session.admin, session.userId, packId, ref)
      : await buyAndOpen(session.admin, session.userId, packId, ref, undefined, priceOpts);

    if (!result.ok) {
      // Fase 38 · los 5xx no filtran mensajes internos (de la RPC o de PostgREST); los 4xx sí dicen qué pasó.
      if (result.status >= 500) {
        console.error("[packs]", action, result.error);
        return NextResponse.json({ error: GENERIC }, { status: result.status, headers: { "cache-control": "no-store" } });
      }
      return NextResponse.json({ error: result.error }, { status: result.status, headers: { "cache-control": "no-store" } });
    }
    /*
     * F73 · «abre sobres»: solo una apertura NUEVA (un reintento devuelve `repeated`) y con el gesto del cliente, que es
     * la clave de la operación (`packOpRef`): el evento cuenta una vez. El servicio de sobres no sabe nada de misiones.
     * La app siempre manda gesto (lo fija la capa de sync); una llamada sin gesto no cuenta (nunca dos veces). Nunca
     * rompe la respuesta: el enganche captura sus errores.
     */
    if (action !== "buy" && ref && result.data && !(result.data as { repeated?: boolean }).repeated) {
      await settleMissionsForOp(session.admin, session.userId, { kind: "OPEN_PACK", key: packOpRef(session.userId, "open", ref), packId });
    }
    return NextResponse.json(result.data, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[packs]", e instanceof Error ? e.message : "error");
    return NextResponse.json({ error: GENERIC }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
