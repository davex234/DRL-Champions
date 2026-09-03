"use client";

/**
 * PRESTIGIO — CAPA DE CLIENTE (Fase 14).
 *
 * Transporte. Qué se puede comprar, cuánto cuesta y si llega el saldo lo decide
 * `services/prestige` contra la base de datos. Aquí no se calcula ni un precio: esta ruta
 * COBRA, y un precio calculado en el navegador es un precio que el navegador puede cambiar.
 */
import { getSupabase } from "@/lib/supabase/client";
import type { PrestigeView, PrestigeBuyResult } from "@/server/services/prestige";

export type { PrestigeView, PrestigeBuyResult };

async function token(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

/** `null` sin sesión: el prestigio se paga con créditos del servidor, no del modo local. */
export async function fetchPrestige(): Promise<PrestigeView | null> {
  const t = await token();
  if (!t) return null;

  const res = await fetch("/api/game/prestige", {
    headers: { authorization: `Bearer ${t}` },
    cache: "no-store",
  });
  if (res.status === 401) return null;
  const json = (await res.json().catch(() => null)) as (PrestigeView & { error?: string }) | null;
  if (!res.ok) throw new Error(json?.error ?? `Error ${res.status}`);
  return json;
}

export async function buyPrestige(setId: string, tierId: string): Promise<PrestigeBuyResult> {
  const t = await token();
  if (!t) throw new Error("Necesitas iniciar sesión");

  const res = await fetch("/api/game/prestige", {
    method: "POST",
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "buy", setId, tierId }),
  });
  const json = (await res.json().catch(() => ({}))) as PrestigeBuyResult & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json;
}
