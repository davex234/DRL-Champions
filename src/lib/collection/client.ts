"use client";

/**
 * COLLECTION ROOM — CLIENTE (Fase 37).
 *
 *   · `fetchCollectionPersonal` → `GET /api/game/collection` (Bearer; nunca un `userId` en la petición).
 *   · `setFavoriteRemote`       → `POST /api/game/collection { action: "favorite", cardId, favorite }`.
 *   · `useCollectionPersonal`   → carga con tiempo máximo, sin conexión, última foto conservada, favoritos optimistas
 *                                  con reversión si el servidor dice que no.
 *
 * Buscar, filtrar y ordenar NO piden nada al servidor: se hacen sobre esta foto y el catálogo público. Los favoritos
 * NO se guardan en el navegador: sin servidor, no hay favoritos (se dice).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { CollectionPersonalView } from "@/server/services/collection";

export type { CollectionPersonalView };

export const COLLECTION_TIMEOUT_MS = 8_000;

export class CollectionError extends Error {
  constructor(message: string, public status: number, public code: string | null) { super(message); }
}

async function authHeader(): Promise<Record<string, string> | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const token = (await sb.auth.getSession()).data.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : null;
}

async function call<T>(init: RequestInit): Promise<T> {
  const headers = await authHeader();
  if (!headers) throw new CollectionError("Inicia sesión", 401, "UNAUTHENTICATED");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), COLLECTION_TIMEOUT_MS);
  try {
    const res = await fetch("/api/game/collection", { ...init, headers: { ...headers, ...(init.body ? { "content-type": "application/json" } : {}) }, cache: "no-store", signal: ctrl.signal });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
    if (!res.ok) throw new CollectionError(json.error ?? "No se pudo completar", res.status, json.code ?? null);
    return json;
  } catch (e) {
    if (e instanceof CollectionError) throw e;
    throw new CollectionError(ctrl.signal.aborted ? "El servidor tarda demasiado" : "Sin conexión con el servidor", 0, ctrl.signal.aborted ? "TIMEOUT" : "NETWORK");
  } finally {
    clearTimeout(timer);
  }
}

export const fetchCollectionPersonal = () => call<CollectionPersonalView>({ method: "GET" });
export const setFavoriteRemote = (cardId: string, favorite: boolean) =>
  call<{ cardId: string; favorite: boolean }>({ method: "POST", body: JSON.stringify({ action: "favorite", cardId, favorite }) });

export type CollectionStatus = "idle" | "loading" | "ready" | "error" | "offline";

export interface CollectionPersonalState {
  data: CollectionPersonalView | null;
  status: CollectionStatus;
  stale: boolean;
  online: boolean;
  refresh: () => void;
  toggleFavorite: (cardId: string) => Promise<{ ok: boolean; message?: string }>;
}

export function useCollectionPersonal({ enabled, userKey }: { enabled: boolean; userKey: string | null }): CollectionPersonalState {
  const [data, setData] = useState<CollectionPersonalView | null>(null);
  const [status, setStatus] = useState<CollectionStatus>(enabled ? "loading" : "idle");
  const [stale, setStale] = useState(false);
  const [online, setOnline] = useState(true);
  const alive = useRef(true);
  const pending = useRef(new Set<string>());

  const load = useCallback(async () => {
    if (!enabled) { setStatus("idle"); return; }
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setOnline(false); setStatus("offline"); setStale(true); return; }
    try {
      const r = await fetchCollectionPersonal();
      if (!alive.current) return;
      setData(r); setStatus("ready"); setStale(false); setOnline(true);
    } catch (e) {
      if (!alive.current) return;
      const off = (typeof navigator !== "undefined" && navigator.onLine === false) || (e instanceof CollectionError && e.code === "NETWORK");
      setStatus(off ? "offline" : "error"); setOnline(!off); setStale(true);
    }
  }, [enabled]);

  useEffect(() => {
    alive.current = true;
    setData(null); setStale(false); setStatus(enabled ? "loading" : "idle");
    void load();
    return () => { alive.current = false; };
  }, [load, userKey, enabled]);

  useEffect(() => {
    const on = () => { setOnline(true); void load(); };
    const off = () => { setOnline(false); setStale(true); };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [load]);

  const toggleFavorite = useCallback(async (cardId: string) => {
    if (!data || data.favorites === null) return { ok: false, message: "Los favoritos no están disponibles todavía" };
    if (!online) return { ok: false, message: "Sin conexión: los favoritos se guardan en el servidor" };
    if (pending.current.has(cardId)) return { ok: false };
    const was = data.favorites.includes(cardId);
    pending.current.add(cardId);
    setData((d) => d && d.favorites ? { ...d, favorites: was ? d.favorites.filter((x) => x !== cardId) : [cardId, ...d.favorites] } : d);
    try {
      await setFavoriteRemote(cardId, !was);
      return { ok: true };
    } catch (e) {
      setData((d) => d && d.favorites ? { ...d, favorites: was ? [cardId, ...d.favorites.filter((x) => x !== cardId)] : d.favorites.filter((x) => x !== cardId) } : d);
      return { ok: false, message: e instanceof CollectionError ? e.message : "No se pudo guardar" };
    } finally {
      pending.current.delete(cardId);
    }
  }, [data, online]);

  return { data, status, stale, online, refresh: () => void load(), toggleFavorite };
}
