/**
 * `/api/game/prestige` — EL SUMIDERO DE FIN DE JUEGO (Fase 14).
 *
 *   GET                                   → PrestigeView
 *   POST { action: "buy", setId, tierId }  → PrestigeBuyResult
 *
 * Esta ruta COBRA, así que la regla de la Fase 11 se aplica con más motivo todavía: **el
 * cuerpo no lleva ni un número**. Dos identificadores, y el precio lo pone `PRESTIGE_TIERS`
 * en el servidor. Si el cliente pudiera nombrar el precio, el precio lo pondría el cliente.
 *
 * `GET` es `no-store`: la vitrina depende del saldo, y un saldo cacheado enseñaría como
 * comprable algo que ya no lo es.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { getPrestige, buyPrestige } from "@/server/services/prestige";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const ID = /^[\w:-]{1,128}$/;

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }
  try {
    const res = await getPrestige(session.admin, session.userId);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status, headers: NO_STORE });
    return NextResponse.json(res.data, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo leer el prestigio" },
      { status: 500, headers: NO_STORE },
    );
  }
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }

  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  const b = (body ?? {}) as Record<string, unknown>;

  if (b.action !== "buy") {
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400, headers: NO_STORE });
  }

  const setId = typeof b.setId === "string" ? b.setId : "";
  const tierId = typeof b.tierId === "string" ? b.tierId : "";
  if (!ID.test(setId) || !ID.test(tierId)) {
    return NextResponse.json({ error: "Identificador inválido" }, { status: 400, headers: NO_STORE });
  }

  try {
    const res = await buyPrestige(session.admin, session.userId, setId, tierId);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status, headers: NO_STORE });
    return NextResponse.json(res.data, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo comprar" },
      { status: 500, headers: NO_STORE },
    );
  }
}
