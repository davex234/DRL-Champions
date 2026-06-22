"use client";

import { getSupabase } from "./client";
import type { Listing, Transaction } from "./types";

type Result<T> = { data?: T; error?: string };

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
  if (!sb) return [];
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
