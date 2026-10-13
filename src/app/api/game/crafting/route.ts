/**
 * F73 · `/api/game/crafting` — CRAFTEO (sobres e intercambio de cartas). Todo en servidor.
 *
 *   GET                                                         → recetas activas, sobres que tienes y cartas entregables
 *   POST { action: "craftPack", recipeId, ref }                 → consume N sobres, entrega 1 (atómico, idempotente)
 *   POST { action: "craftCard", recipeId, uids: string[], ref } → consume N copias, entrega 1 carta ALEATORIA (servidor)
 *
 * El cliente nunca manda cantidades, saldo, inventario ni la carta de salida: cualquier otro campo se rechaza.
 * `ref` es el gesto del cliente (doble clic / F5 / reintento / dos pestañas → misma operación).
 * Sin la migración 0059 aplicada → 503 `MIGRATION_PENDING` (el GET responde `available: false`).
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { internalError } from "@/server/ops/log";
import { takeRate, rateHeaders, TOO_MANY } from "@/server/services/rateLimit";
import { ensureServerPacks } from "@/server/cms/packs";
import { craftCard, craftPack, getCraftingState } from "@/server/services/crafting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 8_000;
const ALLOWED = new Set(["action", "recipeId", "uids", "ref", "expectedQty"]);
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function send<T>(r: { ok: boolean; status: number; error?: string; code?: string; data?: T }) {
  if (!r.ok) return NextResponse.json({ error: r.status >= 500 ? "No se pudo completar el crafteo" : r.error, ...(r.code ? { code: r.code } : {}) }, { status: r.status, headers: NO_STORE });
  return NextResponse.json(r.data, { status: 200, headers: NO_STORE });
}

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  { const rate = await takeRate(session.admin, session.userId, "collection_read"); if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) }); }
  try {
    await ensureServerPacks(session.admin);
    return send(await getCraftingState(session.admin, session.userId));
  } catch (e) { return internalError("api/game/crafting", e, req); }
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  { const rate = await takeRate(session.admin, session.userId, "economy_write"); if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) }); }
  let raw = "";
  try { raw = await req.text(); } catch { /* ilegible */ }
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Cuerpo demasiado grande" }, { status: 413, headers: NO_STORE });
  let body: Record<string, unknown> = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* no JSON */ }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
  if (Object.keys(body).some((k) => !ALLOWED.has(k))) return NextResponse.json({ error: "Campo no permitido", code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
  const action = typeof body.action === "string" ? body.action : "";
  const recipeId = typeof body.recipeId === "string" && ID.test(body.recipeId) ? body.recipeId : "";
  const ref = typeof body.ref === "string" && /^[\w:-]{8,128}$/.test(body.ref) ? body.ref : undefined;
  if (!recipeId) return NextResponse.json({ error: "Receta inválida", code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
  try {
    await ensureServerPacks(session.admin);
    if (action === "craftPack") {
      if (body.uids !== undefined) return NextResponse.json({ error: "Campo no permitido", code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
      // ICON (2026-10-09) · la cantidad que el jugador VIO (opcional; entero 2..100): si la receta cambió, 409 sin cobrar.
      const eq = body.expectedQty;
      if (eq !== undefined && !(typeof eq === "number" && Number.isInteger(eq) && eq >= 2 && eq <= 100)) return NextResponse.json({ error: "Cantidad inválida", code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
      return send(await craftPack(session.admin, session.userId, recipeId, ref, eq as number | undefined));
    }
    if (action === "craftCard") {
      const uids = Array.isArray(body.uids) && body.uids.length <= 100 && body.uids.every((u) => typeof u === "string" && UUID.test(u)) ? (body.uids as string[]) : null;
      if (!uids) return NextResponse.json({ error: "Selección inválida", code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
      return send(await craftCard(session.admin, session.userId, recipeId, uids, ref));
    }
    return NextResponse.json({ error: "Acción inválida", code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
  } catch (e) { return internalError("api/game/crafting", e, req); }
}
