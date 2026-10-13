/**
 * `/api/game/cards` — EJEMPLARES DE TU COLECCIÓN, PAGINADOS (COLECCIONES ILIMITADAS).
 *
 *   GET ?card=<cardId>&sort=serial|uid&locked=0|1&numbered=1&limit=1..100&cursor=<opaco>   → una página
 *   GET ?uids=<uid,uid,…>  (máx. 60)                                                       → ejemplares concretos
 *
 * El usuario sale SIEMPRE del Bearer: no existe parámetro de usuario y cualquier clave desconocida responde 400.
 * Solo lectura. El artwork de los ejemplares de la página viaja resuelto, como en `/api/game/state`.
 * Errores internos → mensaje genérico.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { takeRate, rateHeaders, isDependencyDown, TOO_MANY, UNAVAILABLE } from "@/server/services/rateLimit";
import { listCardInstances, lookupCardInstances, parseCardsQuery } from "@/server/services/cardInstances";
import { artworkDeInstancias } from "@/server/services/cardArtworkUpload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const bad = (error: string, code = "BAD_REQUEST", status = 400) => NextResponse.json({ error, code }, { status, headers: NO_STORE });

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return bad("Inicia sesión para ver tus cartas", "UNAUTHENTICATED", 401);
  const parsed = parseCardsQuery(new URL(req.url).searchParams);
  if (!parsed.ok) return bad(parsed.error, parsed.code, parsed.status);
  const rate = await takeRate(session.admin, session.userId, "cards_read");
  if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, ...rateHeaders(rate.retryAfter) } });
  try {
    const r = parsed.data.kind === "lookup"
      ? await lookupCardInstances(session.admin, session.userId, parsed.data.uids)
      : await listCardInstances(session.admin, session.userId, parsed.data.query);
    if (!r.ok) return bad(r.status >= 500 ? "No se pudieron leer tus cartas" : r.error, r.code, r.status);
    const artworks = await artworkDeInstancias(session.admin, r.data.items).catch(() => ({}));
    return NextResponse.json({ ...r.data, artworks }, { headers: NO_STORE });
  } catch (e) {
    console.error("[cards]", e instanceof Error ? e.message : "error");
    if (isDependencyDown(e)) return NextResponse.json({ error: UNAVAILABLE, code: "UNAVAILABLE" }, { status: 503, headers: { ...NO_STORE, ...rateHeaders(5) } });
    return bad("No se pudieron leer tus cartas", "SERVER_ERROR", 500);
  }
}
