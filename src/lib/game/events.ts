"use client";

/**
 * EVENTO EN VIVO — CAPA DE CLIENTE (Fase 12).
 *
 * Aquí no se decide nada. La fase del evento, el progreso de cada desafío y si algo se
 * puede cobrar los calcula `services/events` con la hora del servidor; este módulo solo
 * transporta. Es la diferencia con `useEventsStore`, que decidía en el navegador y por eso
 * tuvo que quedarse en solo lectura con sesión iniciada.
 *
 * Mismo patrón de autorización que el resto: el token de Supabase en la cabecera, nunca el
 * identificador de usuario en el cuerpo.
 */
import { getSupabase } from "@/lib/supabase/client";
import type { EventView, ClaimResult } from "@/server/services/events";

export type { EventView, ClaimResult };

async function token(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Trae el evento vigente. `null` sin sesión —no es un error— y `null` también cuando no hay
 * ningún evento vivo, que es un estado legítimo del producto y no una pantalla rota.
 */
export async function fetchEvent(): Promise<EventView | null> {
  const t = await token();
  if (!t) return null;

  const res = await fetch("/api/game/events", {
    headers: { authorization: `Bearer ${t}` },
    cache: "no-store",
  });
  if (res.status === 401) return null;
  const json = (await res.json().catch(() => null)) as (EventView & { error?: string }) | null;
  if (!res.ok) throw new Error(json?.error ?? `Error ${res.status}`);
  return json && json.event ? json : null;
}

/** Cobra un desafío. Solo viajan dos identificadores: el premio lo pone el servidor. */
export async function claimChallenge(eventId: string, challengeId: string): Promise<ClaimResult> {
  const t = await token();
  if (!t) throw new Error("Necesitas iniciar sesión");

  const res = await fetch("/api/game/events", {
    method: "POST",
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "claim", eventId, challengeId }),
  });
  const json = (await res.json().catch(() => ({}))) as ClaimResult & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json;
}
