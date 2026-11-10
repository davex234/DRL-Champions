/**
 * `/api/game/market` — MERCADO ENTRE JUGADORES (Fase 11).
 *
 *   POST { action: "config" }
 *   POST { action: "browse", filters? }
 *   POST { action: "mine" }
 *   POST { action: "trades" }
 *   POST { action: "list",   cardUid, price, ref }
 *   POST { action: "cancel", listingId }
 *   POST { action: "buy",    listingId, ref }
 *
 * ────────────────────────── EL INTERRUPTOR ──────────────────────────
 *
 * Si `GLOBAL_MARKET_ENABLED` está apagado, **las lecturas siguen funcionando y las
 * escrituras se rechazan con 503**. Es deliberado: el escaparate se puede enseñar sin
 * riesgo, y lo que hay que apagar es lo que mueve valor. La seguridad real, además, no
 * está aquí sino en la base de datos: las RPC solo las puede ejecutar `service_role`.
 *
 * ────────────────────────── VALIDACIÓN ──────────────────────────
 *
 * Todo lo que entra se acota antes de llegar al servicio: los identificadores tienen que
 * ser uuid, el precio un entero positivo con techo, y el gesto un texto corto. El usuario
 * sale del token y **nunca** del cuerpo.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import {
  browse, myListings, myTrades, marketConfig, listCard, cancelListing, buyListing,
  type BrowseFilters,
} from "@/server/services/market";
import { internalError } from "@/server/ops/log";
import { readJsonObject } from "@/server/http/jsonBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GESTURE = /^[\w:-]{1,128}$/;
/** Techo duro de precio. Muy por encima de cualquier carta y muy por debajo de un desbordamiento. */
const MAX_PRICE = 100_000_000;

/** Acciones que MUEVEN valor. Son las que se apagan con el interruptor. */
const WRITES = new Set(["list", "cancel", "buy"]);

function parseFilters(raw: unknown): BrowseFilters {
  const f = (raw ?? {}) as Record<string, unknown>;
  const sort = typeof f.sort === "string" && ["recent", "price-asc", "price-desc", "ovr"].includes(f.sort)
    ? (f.sort as BrowseFilters["sort"]) : "recent";
  return {
    region: typeof f.region === "string" && f.region.length <= 32 ? f.region : undefined,
    minOvr: typeof f.minOvr === "number" && Number.isFinite(f.minOvr) ? Math.trunc(f.minOvr) : undefined,
    maxPrice: typeof f.maxPrice === "number" && Number.isFinite(f.maxPrice) ? Math.trunc(f.maxPrice) : undefined,
    search: typeof f.search === "string" && f.search.length <= 64 ? f.search : undefined,
    sort,
    limit: typeof f.limit === "number" ? Math.trunc(f.limit) : undefined,
  };
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }

  let body: Record<string, unknown> = {};
  body = ((await readJsonObject(req)) ?? {}) as typeof body; // FULL GAME AUDIT · `null`/no-objeto ya no da 500
  const action = typeof body.action === "string" ? body.action : "";

  if (WRITES.has(action) && !GLOBAL_MARKET_ENABLED) {
    return NextResponse.json(
      { error: "El mercado entre jugadores todavía no está abierto" },
      { status: 503, headers: NO_STORE },
    );
  }

  const send = <T,>(r: { ok: true; data: T } | { ok: false; error: string; status: number }) =>
    r.ok
      ? NextResponse.json(r.data, { headers: NO_STORE })
      : NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });

  try {
    switch (action) {
      case "config":
        return send(await marketConfig(session.admin));

      case "browse":
        return send(await browse(session.admin, parseFilters(body.filters)));

      case "mine":
        return send(await myListings(session.admin, session.userId));

      case "trades":
        return send(await myTrades(session.admin, session.userId));

      case "list": {
        const cardUid = typeof body.cardUid === "string" && UUID.test(body.cardUid) ? body.cardUid : null;
        const price = typeof body.price === "number" && Number.isFinite(body.price) ? Math.trunc(body.price) : NaN;
        const gesture = typeof body.ref === "string" && GESTURE.test(body.ref) ? body.ref : null;
        if (!cardUid) return NextResponse.json({ error: "Carta no válida" }, { status: 400, headers: NO_STORE });
        if (!Number.isInteger(price) || price <= 0 || price > MAX_PRICE) {
          return NextResponse.json({ error: "Precio no válido" }, { status: 400, headers: NO_STORE });
        }
        if (!gesture) return NextResponse.json({ error: "Falta la clave de la operación" }, { status: 400, headers: NO_STORE });
        return send(await listCard(
          session.admin, session.userId, cardUid, price, `market:list:${session.userId}:${gesture}`));
      }

      case "cancel": {
        const listingId = typeof body.listingId === "string" && UUID.test(body.listingId) ? body.listingId : null;
        if (!listingId) return NextResponse.json({ error: "Listado no válido" }, { status: 400, headers: NO_STORE });
        return send(await cancelListing(session.admin, session.userId, listingId));
      }

      case "buy": {
        const listingId = typeof body.listingId === "string" && UUID.test(body.listingId) ? body.listingId : null;
        const gesture = typeof body.ref === "string" && GESTURE.test(body.ref) ? body.ref : null;
        if (!listingId) return NextResponse.json({ error: "Listado no válido" }, { status: 400, headers: NO_STORE });
        if (!gesture) return NextResponse.json({ error: "Falta la clave de la operación" }, { status: 400, headers: NO_STORE });
        return send(await buyListing(
          session.admin, session.userId, listingId, `market:buy:${session.userId}:${gesture}`));
      }

      default:
        return NextResponse.json({ error: "Acción inválida" }, { status: 400, headers: NO_STORE });
    }
  } catch (e) {
    return internalError("api/game/market", e, req);
  }
}
