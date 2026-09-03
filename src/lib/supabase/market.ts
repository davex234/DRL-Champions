"use client";

import { getSupabase } from "./client";
import type {
  Listing, Transaction, Offer, OfferKind, CardPriceStats, CardPriceDaily,
  MarketConfig, ListingSearchRow, TopCardRow, RarityStatRow,
} from "./types";

type Result<T> = { data?: T; error?: string };

/**
 * BUG-10 — Los filtros `.or()` de PostgREST se construyen concatenando texto, así que un
 * valor con comas o paréntesis puede alterar la expresión. Hoy `userId` viene siempre de
 * la sesión y es un UUID, pero se valida igualmente para que el patrón no sea explotable
 * el día que alguien pase un parámetro de usuario.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string): boolean => UUID_RE.test(v);

/** Listados activos del mercado global (de todos los jugadores). */
export async function fetchActiveListings(limit = 100): Promise<Listing[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("market_listings")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as Listing[]) ?? [];
}

/** Listados activos de un tipo de carta concreto (para su ficha de detalle). */
export async function fetchListingsForCard(cardId: string): Promise<Listing[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("market_listings")
    .select("*")
    .eq("card_id", cardId)
    .eq("status", "active")
    .order("price", { ascending: true });
  return (data as Listing[]) ?? [];
}

export async function fetchMyListings(userId: string): Promise<Listing[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("market_listings")
    .select("*")
    .eq("seller_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  return (data as Listing[]) ?? [];
}

export async function fetchMyTransactions(userId: string): Promise<Transaction[]> {
  const sb = getSupabase();
  if (!sb || !isUuid(userId)) return [];
  const { data } = await sb
    .from("transactions")
    .select("*")
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data as Transaction[]) ?? [];
}

/** Deposita la carta en el inventario de servidor y la publica en el mercado. */
export async function listCardOnline(cardId: string, serial: number | null, price: number): Promise<Result<string>> {
  const sb = getSupabase();
  if (!sb) return { error: "No configurado" };
  const dep = await sb.rpc("deposit_card", { p_card_id: cardId, p_serial: serial });
  if (dep.error) return { error: dep.error.message };
  const res = await sb.rpc("create_listing", { p_card_id: cardId, p_serial: serial, p_price: price });
  return res.error ? { error: res.error.message } : { data: res.data as string };
}

/** Compra un listado (transferencia atómica validada en servidor). */
export async function buyListingOnline(listingId: string): Promise<Result<string>> {
  const sb = getSupabase();
  if (!sb) return { error: "No configurado" };
  const res = await sb.rpc("buy_listing", { p_listing_id: listingId });
  return res.error ? { error: res.error.message } : { data: res.data as string };
}

export async function cancelListingOnline(listingId: string): Promise<Result<null>> {
  const sb = getSupabase();
  if (!sb) return { error: "No configurado" };
  const res = await sb.rpc("cancel_listing", { p_listing_id: listingId });
  return res.error ? { error: res.error.message } : {};
}

/* ----------------------------- Búsqueda paginada ----------------------------- */
export interface ListingSearchParams {
  query?: string;
  rankMin?: number;
  rankMax?: number;
  region?: string;
  sort?: "recent" | "price_asc" | "price_desc" | "rarity" | "deal";
  limit?: number;
  offset?: number;
}

/** Búsqueda server-side de listados activos (escalable, paginada). */
export async function searchListings(p: ListingSearchParams = {}): Promise<ListingSearchRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.rpc("search_listings", {
    p_query: p.query?.trim() || null,
    p_rank_min: p.rankMin ?? null,
    p_rank_max: p.rankMax ?? null,
    p_region: p.region ?? null,
    p_sort: p.sort ?? "recent",
    p_limit: p.limit ?? 40,
    p_offset: p.offset ?? 0,
  });
  if (error) return [];
  return (data as ListingSearchRow[]) ?? [];
}

/* ----------------------------- Ofertas ----------------------------- */
/** Crea una oferta (retiene créditos en depósito). `listing` o `card`. */
export async function makeOffer(args: {
  kind: OfferKind;
  cardId?: string;
  serial?: number | null;
  listingId?: string;
  price: number;
}): Promise<Result<string>> {
  const sb = getSupabase();
  if (!sb) return { error: "No configurado" };
  const res = await sb.rpc("make_offer", {
    p_kind: args.kind,
    p_card_id: args.cardId ?? null,
    p_serial: args.serial ?? null,
    p_listing_id: args.listingId ?? null,
    p_price: args.price,
  });
  return res.error ? { error: res.error.message } : { data: res.data as string };
}

export async function cancelOffer(offerId: string): Promise<Result<null>> {
  const sb = getSupabase();
  if (!sb) return { error: "No configurado" };
  const res = await sb.rpc("cancel_offer", { p_offer_id: offerId });
  return res.error ? { error: res.error.message } : {};
}

export async function acceptOffer(offerId: string): Promise<Result<string>> {
  const sb = getSupabase();
  if (!sb) return { error: "No configurado" };
  const res = await sb.rpc("accept_offer", { p_offer_id: offerId });
  return res.error ? { error: res.error.message } : { data: res.data as string };
}

/** Ofertas activas por tipo de carta (pujas visibles). */
export async function fetchOffersForCard(cardId: string): Promise<Offer[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("market_offers")
    .select("*")
    .eq("card_id", cardId)
    .eq("status", "active")
    .order("price", { ascending: false });
  return (data as Offer[]) ?? [];
}

export async function fetchOffersForListing(listingId: string): Promise<Offer[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("market_offers")
    .select("*")
    .eq("listing_id", listingId)
    .eq("status", "active")
    .order("price", { ascending: false });
  return (data as Offer[]) ?? [];
}

export async function fetchMyOffers(userId: string): Promise<Offer[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("market_offers")
    .select("*")
    .eq("buyer_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  return (data as Offer[]) ?? [];
}

/* ----------------------------- Historial / analítica ----------------------------- */
export async function fetchCardPriceStats(cardId: string): Promise<CardPriceStats | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("card_price_stats").select("*").eq("card_id", cardId).maybeSingle();
  return (data as CardPriceStats) ?? null;
}

/** Serie diaria de precio para la gráfica de evolución (últimos `days` días). */
export async function fetchCardPriceDaily(cardId: string, days = 60): Promise<CardPriceDaily[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("card_price_daily")
    .select("*")
    .eq("card_id", cardId)
    .order("day", { ascending: true })
    .limit(days);
  return (data as CardPriceDaily[]) ?? [];
}

/** Ranking de cartas más valiosas. */
export async function fetchTopCards(limit = 50): Promise<TopCardRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("v_market_top_cards").select("*").limit(limit);
  return (data as TopCardRow[]) ?? [];
}

/** Estadísticas por rareza. */
export async function fetchRarityStats(): Promise<RarityStatRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("v_market_rarity_stats").select("*");
  return (data as RarityStatRow[]) ?? [];
}

export async function fetchMarketConfig(): Promise<MarketConfig | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("market_config").select("*").eq("id", "default").maybeSingle();
  return (data as MarketConfig) ?? null;
}
