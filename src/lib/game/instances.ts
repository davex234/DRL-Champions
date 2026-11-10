"use client";

/**
 * EJEMPLARES DE LA COLECCIÓN — CLIENTE (COLECCIONES ILIMITADAS).
 *
 * El estado de juego trae un ejemplar por carta y los recuentos. Las COPIAS concretas se piden aquí, por páginas
 * (`/api/game/cards`), solo cuando una pantalla las enseña. El usuario sale del token: no hay parámetro de usuario.
 */
import type { OwnedCard } from "@/domain/cards/types";
import type { ArtworkByUid } from "@/domain/cards/artwork";
import { getSupabase } from "@/lib/supabase/client";

/** Un ejemplar tal y como lo devuelve el servidor. */
export interface CardInstance {
  uid: string;
  cardId: string;
  serial: number | null;
  mintedVersion: number | null;
  obtainedAt: number;
  origin: string;
  locked: boolean;
}

export interface CardInstancesPage {
  items: CardInstance[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Solo en la primera página. */
  total: number | null;
  artworks?: ArtworkByUid;
}

export interface CardInstancesQuery {
  cardId?: string | null;
  sort?: "serial" | "uid";
  locked?: boolean | null;
  numbered?: boolean;
  limit?: number;
  cursor?: string | null;
}

/** Error de la API con su código y, si lo hay, cuándo reintentar. */
export class CardsApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null, readonly retryAfter: number | null) { super(message); this.name = "CardsApiError"; }
}

export const toOwnedCard = (i: CardInstance): OwnedCard => ({ uid: i.uid, cardId: i.cardId, serial: i.serial ?? undefined, obtainedAt: i.obtainedAt, mintedVersion: i.mintedVersion });

async function bearer(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

async function get<T>(query: string, signal?: AbortSignal): Promise<T | null> {
  const token = await bearer();
  if (!token) return null;
  const res = await fetch(`/api/game/cards?${query}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal });
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    const retry = Number(res.headers.get("retry-after"));
    throw new CardsApiError(json.error ?? `Error ${res.status}`, res.status, json.code ?? null, Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  return json as T;
}

/** Una página de ejemplares. `null` sin sesión. */
export async function fetchCardInstances(q: CardInstancesQuery, signal?: AbortSignal): Promise<CardInstancesPage | null> {
  const p = new URLSearchParams();
  if (q.cardId) p.set("card", q.cardId);
  if (q.sort) p.set("sort", q.sort);
  if (q.locked === true || q.locked === false) p.set("locked", q.locked ? "1" : "0");
  if (q.numbered) p.set("numbered", "1");
  if (q.limit) p.set("limit", String(q.limit));
  if (q.cursor) p.set("cursor", q.cursor);
  return get<CardInstancesPage>(p.toString(), signal);
}

/** Ejemplares que se pueden pedir por `uid` en una llamada (el mismo tope que el servidor). */
export const LOOKUP_CHUNK = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Ejemplares concretos por `uid`. Los que no son tuyos (o ya no existen) no vuelven. `null` sin sesión. */
export async function fetchInstancesByUid(uids: readonly string[], signal?: AbortSignal): Promise<{ items: CardInstance[]; artworks: ArtworkByUid } | null> {
  const wanted = [...new Set(uids.filter((u) => UUID.test(u)))];
  const items: CardInstance[] = [];
  let artworks: ArtworkByUid = {};
  for (let i = 0; i < wanted.length; i += LOOKUP_CHUNK) {
    const page = await get<{ items: CardInstance[]; artworks?: ArtworkByUid }>(`uids=${wanted.slice(i, i + LOOKUP_CHUNK).join(",")}`, signal);
    if (!page) return null;
    items.push(...page.items);
    artworks = { ...artworks, ...(page.artworks ?? {}) };
  }
  return { items, artworks };
}
