"use client";

/**
 * MAESTRÍA DE COLECCIÓN — CAPA DE CLIENTE (Fase 13).
 *
 * Transporte y nada más. Qué conjuntos existen, cuánto llevas y qué se puede cobrar lo
 * calcula `services/mastery` contra `user_cards`, que es donde está la propiedad. Si esto
 * calculara el progreso con el inventario local, un jugador sin conexión vería escalones
 * cobrables que el servidor rechazaría.
 */
import { getSupabase } from "@/lib/supabase/client";
import type { MasteryView, MasterySetView, MasteryClaimResult } from "@/server/services/mastery";

export type { MasteryView, MasterySetView, MasteryClaimResult };

async function token(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

/** `null` sin sesión: la maestría es de la colección del servidor, no del modo local. */
export async function fetchMastery(): Promise<MasteryView | null> {
  const t = await token();
  if (!t) return null;

  const res = await fetch("/api/game/mastery", {
    headers: { authorization: `Bearer ${t}` },
    cache: "no-store",
  });
  if (res.status === 401) return null;
  const json = (await res.json().catch(() => null)) as (MasteryView & { error?: string }) | null;
  if (!res.ok) throw new Error(json?.error ?? `Error ${res.status}`);
  return json;
}

export async function claimMastery(setId: string, at: number): Promise<MasteryClaimResult> {
  const t = await token();
  if (!t) throw new Error("Necesitas iniciar sesión");

  const res = await fetch("/api/game/mastery", {
    method: "POST",
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "claim", setId, at }),
  });
  const json = (await res.json().catch(() => ({}))) as MasteryClaimResult & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json;
}
