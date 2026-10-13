"use client";

/**
 * ECONOMÍA — CAPA DE CLIENTE (Fase 11).
 *
 * Aquí no se calcula ni un crédito. El importe del desguace lo decide el servidor con la
 * tabla del dominio; esto solo transporta qué cartas se quieren desguazar y enseña lo que
 * el servidor responde.
 *
 * Cada operación viaja con un GESTO. El servidor lo convierte en clave de idempotencia:
 * reintentar el mismo gesto no cobra ni borra dos veces.
 */
import { getSupabase } from "@/lib/supabase/client";
import { newGesture } from "./client";
import type { SalvagePreview } from "@/server/services/economy";

export type { SalvagePreview };

async function post<T>(body: unknown): Promise<T> {
  const sb = getSupabase();
  if (!sb) throw new Error("La economía necesita una cuenta online");
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Inicia sesión para continuar");

  const res = await fetch("/api/game/economy", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json;
}

/** Qué duplicados tienes y cuánto pagaría el servidor por ellos. Solo lectura. */
export const fetchSalvagePreview = () => post<SalvagePreview>({ action: "salvagePreview" });

export interface SalvageResult {
  credits: number;
  salvaged: number;
  paid: number;
  /** `true` si esta petición era un reintento: no se ha vuelto a cobrar. */
  repeated: boolean;
}

/** Desguaza los ejemplares indicados. El servidor vuelve a validar cuáles son válidos. */
export const salvage = (uids: string[], ref = newGesture(), confirmProtected: string[] = []) =>
  post<SalvageResult>({ action: "salvage", uids, ref, ...(confirmProtected.length ? { confirmProtected } : {}) });
