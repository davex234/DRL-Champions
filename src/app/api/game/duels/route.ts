/**
 * `/api/game/duels` — MAZOS DE DUELO del usuario autenticado (Fase 8).
 *
 *   GET                                    → { decks, collection }
 *   POST { action: "save",   id?, name, cardUids }
 *   POST { action: "delete", id }
 *
 * El usuario sale SIEMPRE del token, nunca del cuerpo. La propiedad de cada carta se comprueba
 * contra `user_cards` antes de guardar: un mazo con una instancia ajena se rechaza con 403.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { listDecks, listCollection, saveDeck, deleteDeck } from "@/server/services/duels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    const [decks, collection] = await Promise.all([
      listDecks(session.admin, session.userId),
      listCollection(session.admin, session.userId),
    ]);
    if (!decks.ok) return NextResponse.json({ error: decks.error }, { status: decks.status });
    if (!collection.ok) return NextResponse.json({ error: collection.error }, { status: collection.status });
    return NextResponse.json(
      { decks: decks.data!.decks, collection: collection.data!.cards },
      { headers: NO_STORE },
    );
  } catch (e) {
    return NextResponse.json({ error: message(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* cuerpo vacío */ }

  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "save") {
      const name = typeof body.name === "string" ? body.name : "";
      const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : undefined;
      const cardUids = Array.isArray(body.cardUids)
        ? body.cardUids.filter((u): u is string => typeof u === "string" && UUID.test(u))
        : null;
      if (cardUids === null) return NextResponse.json({ error: "Cartas no válidas" }, { status: 400 });
      const r = await saveDeck(session.admin, session.userId, { id, name, cardUids });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json(r.data, { headers: NO_STORE });
    }

    if (action === "delete") {
      const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : "";
      if (!id) return NextResponse.json({ error: "Mazo no válido" }, { status: 400 });
      const r = await deleteDeck(session.admin, session.userId, id);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json(r.data, { headers: NO_STORE });
    }

    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: message(e) }, { status: 500 });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const message = (e: unknown) => (e instanceof Error ? e.message : "Error en la operación");
