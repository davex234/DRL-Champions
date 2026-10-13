"use client";

/**
 * F82 · SALA DE TROFEOS — CLIENTE. Transporte hacia `/api/game/collection-sets`; aquí no se decide nada: el progreso,
 * lo que falta y si se puede reclamar los calcula el servidor contra tu inventario real.
 */
import { getSupabase } from "@/lib/supabase/client";
import type { TrophyRoomView, ClaimView, SetView } from "@/server/services/collectionSets";

export type { TrophyRoomView, ClaimView, SetView };

export class TrophyError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = "TrophyError"; }
}

async function headers(json = false): Promise<Record<string, string>> {
  const out: Record<string, string> = json ? { "content-type": "application/json" } : {};
  const sb = getSupabase();
  if (!sb) return out;
  const { data } = await sb.auth.getSession();
  const t = data.session?.access_token;
  if (t) out.authorization = `Bearer ${t}`;
  return out;
}

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new TrophyError(json.error ?? `Error ${res.status}`, res.status, json.code);
  return json;
}

export async function fetchTrophyRoom(): Promise<TrophyRoomView> {
  return parse(await fetch("/api/game/collection-sets", { headers: await headers(), cache: "no-store" }));
}

export async function claimCollectionSet(setId: string): Promise<ClaimView> {
  return parse(await fetch("/api/game/collection-sets", { method: "POST", headers: await headers(true), body: JSON.stringify({ action: "claim", setId }) }));
}

export function trophyErrorText(e: unknown, fallback = "No se pudo cargar la Sala de Trofeos."): string {
  if (e instanceof TrophyError) {
    if (e.status === 429) return "Demasiadas peticiones: espera unos segundos.";
    if (e.status === 503) return "La Sala de Trofeos no está disponible ahora mismo.";
    if (e.status === 401) return "Tu sesión ha caducado: vuelve a entrar.";
    if (e.status === 409 || e.status === 404) return e.message;
  }
  return fallback;
}
