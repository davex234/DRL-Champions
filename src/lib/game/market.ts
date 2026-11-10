"use client";

/**
 * MERCADO — CAPA DE CLIENTE (Fase 11).
 *
 * Sustituye a `lib/supabase/market.ts` para el mercado entre jugadores. La diferencia no es
 * cosmética: aquella hablaba **directamente** con las RPC de la base de datos desde el
 * navegador y reconciliaba a mano dos libros de propiedad (el store local y la tabla
 * `inventory`), que es de donde salieron los tres fallos que cerraron el mercado en la
 * Fase A.
 *
 * Esto no habla con la base de datos: habla con `/api/game/market`, que resuelve el usuario
 * desde el token y llama a RPC que solo puede ejecutar el servidor. **El navegador no
 * escribe propiedad ni saldo.**
 *
 * Aquí no se calcula ningún precio ni ninguna comisión: llegan resueltos.
 */
import { getSupabase } from "@/lib/supabase/client";
import { newGesture } from "./client";
import type { ListingView, BrowseFilters, TradeRow } from "@/server/services/market";

export type { ListingView, BrowseFilters, TradeRow };

async function post<T>(body: unknown): Promise<T> {
  const sb = getSupabase();
  if (!sb) throw new Error("El mercado necesita una cuenta online");
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Inicia sesión para entrar en el mercado");

  const res = await fetch("/api/game/market", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json;
}

export interface MarketConfigView {
  feeBps: number;
  minPrice: number;
  minMult: number;
  maxMult: number;
}

export const fetchMarketConfig = () => post<MarketConfigView>({ action: "config" });

export const browseMarket = (filters: BrowseFilters = {}) =>
  post<{ listings: ListingView[] }>({ action: "browse", filters });

export const fetchMyListings = () =>
  post<{ listings: (ListingView & { status: string })[] }>({ action: "mine" });

export const fetchMyTrades = () => post<{ trades: TradeRow[] }>({ action: "trades" });

export const listCardOnMarket = (cardUid: string, price: number, ref = newGesture()) =>
  post<{ listingId: string; cardId: string; price: number; repeated: boolean }>(
    { action: "list", cardUid, price, ref });

export const cancelMyListing = (listingId: string) =>
  post<{ listingId: string }>({ action: "cancel", listingId });

export const buyFromMarket = (listingId: string, ref = newGesture()) =>
  post<{ transactionId: string; cardId: string; price: number; fee: number; credits: number; repeated: boolean }>(
    { action: "buy", listingId, ref });
