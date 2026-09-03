/**
 * MERCADO ENTRE JUGADORES (Fase 11, SOLO SERVIDOR).
 *
 * Orquesta las RPC de la migración 0020, que son las que operan sobre la propiedad REAL
 * (`user_cards`) y pasan por el libro mayor. Aquí no se mueve ni un crédito ni una carta:
 * se valida la forma de la petición, se resuelve el catálogo para enriquecer lo que se
 * enseña, y se traducen los errores de la base de datos a algo que un jugador entienda.
 *
 * ────────────────────────── LAS TRES REGLAS ──────────────────────────
 *
 * **1. El usuario sale del token.** Nunca del cuerpo. Se pasa como parámetro a la RPC, que
 * vuelve a comprobar la propiedad por su cuenta: dos puertas, no una.
 *
 * **2. El precio lo pone el VENDEDOR, pero la banda la pone el servidor.** Un jugador
 * puede pedir lo que quiera dentro de la banda que fija `market_config` respecto al precio
 * de referencia de esa carta. Fuera de banda, la base de datos lo rechaza y deja una marca
 * — no es una comprobación de interfaz.
 *
 * **3. Todo lo que mueve valor lleva clave de idempotencia.** Publicar y comprar la
 * exigen. Cancelar no la necesita: es idempotente por naturaleza (cancelar dos veces el
 * mismo listado falla la segunda por estado, que es la respuesta correcta).
 *
 * ────────────────────────── LO QUE NO HACE ──────────────────────────
 *
 * No decide si el mercado está abierto. Eso lo dice `config/features`, y la ruta lo
 * comprueba antes de llamar aquí: un interruptor de producto no debe vivir en la capa que
 * ejecuta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCard, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { marketValue } from "@/domain/economy/pricing";

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

const fail = (error: string, status = 400): { ok: false; error: string; status: number } =>
  ({ ok: false, error, status });

/** Traduce el error de una RPC a un mensaje de jugador y su código HTTP. */
function translate(message: string): { error: string; status: number } {
  const m = message ?? "";
  if (m.includes("No posees esa carta")) return { error: "Esa carta no es tuya", status: 403 };
  if (m.includes("ya está en venta")) return { error: "Esa carta ya está publicada", status: 409 };
  if (m.includes("no está disponible")) return { error: "Ese listado ya no está disponible", status: 409 };
  if (m.includes("no es tuyo")) return { error: "Ese listado no es tuyo", status: 403 };
  if (m.includes("ya no está activo")) return { error: "Ese listado ya no está activo", status: 409 };
  if (m.includes("tu propio listado")) return { error: "No puedes comprar tu propio listado", status: 409 };
  if (m.includes("Saldo insuficiente")) return { error: "No tienes créditos suficientes", status: 409 };
  if (m.includes("precio mínimo") || m.includes("El precio mínimo")) return { error: m, status: 400 };
  if (m.includes("fuera de banda")) return { error: m, status: 400 };
  if (m.includes("límite de")) return { error: m, status: 429 };
  if (m.includes("versión anterior")) return { error: m, status: 409 };
  return { error: m || "No se pudo completar la operación", status: 500 };
}

// ───────────────────────────── Lectura ─────────────────────────────

export interface ListingView {
  id: string;
  cardId: string;
  cardUid: string | null;
  serial: number | null;
  price: number;
  sellerId: string;
  createdAt: string;
  /** Datos del catálogo, resueltos en servidor para que la pantalla no los invente. */
  nick: string;
  team: string;
  region: string;
  ovr: number;
  variantId: string;
  variantLabel: string;
  rank: number;
  /** Precio de referencia del catálogo. Es una ORIENTACIÓN, no un límite. */
  reference: number;
}

export interface BrowseFilters {
  region?: string;
  minOvr?: number;
  maxPrice?: number;
  search?: string;
  sort?: "recent" | "price-asc" | "price-desc" | "ovr";
  limit?: number;
}

/** Enriquece un listado con el catálogo. Devuelve `null` si la carta ya no existe. */
function toView(row: {
  id: string; card_id: string; card_uid: string | null; serial: number | null;
  price: number; seller_id: string; created_at: string;
}): ListingView | null {
  const def = getCard(row.card_id);
  if (!def) return null;
  const player = getPlayer(def.playerId);
  const variant = getVariant(def.variantId);
  return {
    id: row.id,
    cardId: row.card_id,
    cardUid: row.card_uid,
    serial: row.serial,
    price: Number(row.price),
    sellerId: row.seller_id,
    createdAt: row.created_at,
    nick: player?.nick ?? def.playerId,
    team: player?.team ?? "",
    region: player?.region ?? "",
    ovr: def.ovr,
    variantId: def.variantId,
    variantLabel: variant.label,
    rank: variant.rank,
    reference: marketValue(def),
  };
}

/**
 * El escaparate.
 *
 * Los filtros que la base de datos puede aplicar (precio, orden, límite) van en la
 * consulta; los que dependen del CATÁLOGO (región, media, nombre) se aplican en Node,
 * porque esos datos no están en la base de datos: viven en el catálogo del juego. Traer de
 * más y filtrar aquí es correcto mientras el mercado sea pequeño, y está documentado como
 * lo primero que habría que mover a la base de datos si crece.
 */
export async function browse(
  sb: SupabaseClient, filters: BrowseFilters = {},
): Promise<ServiceResult<{ listings: ListingView[] }>> {
  const limit = Math.min(Math.max(filters.limit ?? 60, 1), 200);

  let q = sb.from("market_listings")
    .select("id, card_id, card_uid, serial, price, seller_id, created_at")
    .eq("status", "active");

  if (typeof filters.maxPrice === "number") q = q.lte("price", filters.maxPrice);

  q = filters.sort === "price-asc" ? q.order("price", { ascending: true })
    : filters.sort === "price-desc" ? q.order("price", { ascending: false })
    : q.order("created_at", { ascending: false });

  const { data, error } = await q.limit(limit * 3);
  if (error) return fail(error.message, 500);

  let views = ((data ?? []) as Parameters<typeof toView>[0][])
    .map(toView)
    .filter((v): v is ListingView => v !== null);

  if (filters.region) views = views.filter((v) => v.region === filters.region);
  if (typeof filters.minOvr === "number") views = views.filter((v) => v.ovr >= filters.minOvr!);
  if (filters.search) {
    const s = filters.search.trim().toLowerCase();
    views = views.filter((v) => `${v.nick} ${v.team}`.toLowerCase().includes(s));
  }
  if (filters.sort === "ovr") views.sort((a, b) => b.ovr - a.ovr || a.price - b.price);

  return { ok: true, data: { listings: views.slice(0, limit) } };
}

/** Mis listados, en cualquier estado. Es el historial de lo que he puesto en venta. */
export async function myListings(
  sb: SupabaseClient, userId: string,
): Promise<ServiceResult<{ listings: (ListingView & { status: string })[] }>> {
  const { data, error } = await sb.from("market_listings")
    .select("id, card_id, card_uid, serial, price, seller_id, created_at, status")
    .eq("seller_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return fail(error.message, 500);

  const listings = ((data ?? []) as (Parameters<typeof toView>[0] & { status: string })[])
    .map((r) => { const v = toView(r); return v ? { ...v, status: r.status } : null; })
    .filter((v): v is ListingView & { status: string } => v !== null);
  return { ok: true, data: { listings } };
}

export interface TradeRow {
  id: string;
  cardId: string;
  nick: string;
  price: number;
  fee: number;
  createdAt: string;
  side: "buy" | "sell";
}

/** Mis compras y ventas cerradas. Sale de `transactions`, que es el registro real. */
export async function myTrades(
  sb: SupabaseClient, userId: string,
): Promise<ServiceResult<{ trades: TradeRow[] }>> {
  const { data, error } = await sb.from("transactions")
    .select("id, buyer_id, seller_id, card_id, price, tax, created_at")
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return fail(error.message, 500);

  const trades = ((data ?? []) as {
    id: string; buyer_id: string; seller_id: string; card_id: string;
    price: number; tax: number | null; created_at: string;
  }[]).map((t) => {
    const def = getCard(t.card_id);
    return {
      id: t.id,
      cardId: t.card_id,
      nick: def ? (getPlayer(def.playerId)?.nick ?? def.playerId) : t.card_id,
      price: Number(t.price),
      fee: Number(t.tax ?? 0),
      createdAt: t.created_at,
      side: (t.buyer_id === userId ? "buy" : "sell") as "buy" | "sell",
    };
  });
  return { ok: true, data: { trades } };
}

/** La configuración vigente del mercado. La lee la pantalla para explicar la comisión. */
export async function marketConfig(
  sb: SupabaseClient,
): Promise<ServiceResult<{ feeBps: number; minPrice: number; minMult: number; maxMult: number }>> {
  const { data, error } = await sb.from("market_config")
    .select("tax_bps, min_price, min_price_mult, max_price_mult").eq("id", "default").maybeSingle();
  if (error) return fail(error.message, 500);
  const c = (data ?? {}) as { tax_bps?: number; min_price?: number; min_price_mult?: number; max_price_mult?: number };
  return {
    ok: true,
    data: {
      feeBps: c.tax_bps ?? 500,
      minPrice: Number(c.min_price ?? 25),
      minMult: Number(c.min_price_mult ?? 0.2),
      maxMult: Number(c.max_price_mult ?? 10),
    },
  };
}

// ───────────────────────────── Escritura ─────────────────────────────

export async function listCard(
  sb: SupabaseClient, userId: string, cardUid: string, price: number, ref: string,
): Promise<ServiceResult<{ listingId: string; cardId: string; price: number; repeated: boolean }>> {
  if (!Number.isInteger(price) || price <= 0) return fail("Precio no válido", 400);

  const { data, error } = await sb.rpc("app_market_list", {
    p_user: userId, p_card_uid: cardUid, p_price: price, p_ref: ref,
  });
  if (error) { const t = translate(error.message); return fail(t.error, t.status); }

  const r = (data ?? {}) as { listingId: string; cardId: string; price: number; repeated?: boolean };
  return { ok: true, data: { listingId: r.listingId, cardId: r.cardId, price: Number(r.price), repeated: r.repeated === true } };
}

export async function cancelListing(
  sb: SupabaseClient, userId: string, listingId: string,
): Promise<ServiceResult<{ listingId: string }>> {
  const { error } = await sb.rpc("app_market_cancel", { p_user: userId, p_listing_id: listingId });
  if (error) { const t = translate(error.message); return fail(t.error, t.status); }
  return { ok: true, data: { listingId } };
}

export async function buyListing(
  sb: SupabaseClient, userId: string, listingId: string, ref: string,
): Promise<ServiceResult<{
  transactionId: string; cardId: string; price: number; fee: number; credits: number; repeated: boolean;
}>> {
  const { data, error } = await sb.rpc("app_market_buy", {
    p_user: userId, p_listing_id: listingId, p_ref: ref,
  });
  if (error) { const t = translate(error.message); return fail(t.error, t.status); }

  const r = (data ?? {}) as {
    transactionId: string; cardId: string; price: number; fee: number; credits: number; repeated?: boolean;
  };
  return {
    ok: true,
    data: {
      transactionId: r.transactionId, cardId: r.cardId,
      price: Number(r.price), fee: Number(r.fee), credits: Number(r.credits),
      repeated: r.repeated === true,
    },
  };
}

/** Caduca los listados vencidos. Lo llama una tarea de operación, no el jugador. */
export async function expireListings(sb: SupabaseClient): Promise<number> {
  const { data, error } = await sb.rpc("app_market_expire");
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}
