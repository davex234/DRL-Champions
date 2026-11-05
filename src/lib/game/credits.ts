"use client";

/**
 * DRL CREDITS — CAPA DE CLIENTE (Fase 18.1).
 *
 * Transporte, y nada más. Cuántos DRL Credits concede cada paquete lo decide el catálogo
 * del SERVIDOR: aquí no hay cantidades, ni precios, ni aritmética de saldo. El cliente
 * solo puede nombrar un `productId`; si intentara enviar `credits` o `amount`, la ruta lo
 * rechaza con un 400 explícito.
 *
 * Ninguna de estas llamadas cobra dinero real. Son de PRUEBA y el servidor lo confirma en
 * cada respuesta con `sandbox: true`.
 */
import { getSupabase } from "@/lib/supabase/client";
import type { CreditsView, PurchaseResult, RefundResult } from "@/server/services/credits";

export type { CreditsView, PurchaseResult, RefundResult };

async function token(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

/** `null` sin sesión: los DRL Credits viven en el servidor, no en el modo local. */
export async function fetchCredits(): Promise<CreditsView | null> {
  const t = await token();
  if (!t) return null;

  const res = await fetch("/api/game/credits", {
    headers: { authorization: `Bearer ${t}` },
    cache: "no-store",
  });
  if (res.status === 401) return null;
  const json = (await res.json().catch(() => null)) as (CreditsView & { error?: string }) | null;
  if (!res.ok) throw new Error(json?.error ?? `Error ${res.status}`);
  return json;
}

/**
 * Compra de PRUEBA. `ref` es el gesto: identifica esta pulsación concreta y hace que
 * reintentarla —por doble clic, por reconexión— no conceda dos veces.
 */
export async function purchaseCredits(productId: string, ref: string): Promise<PurchaseResult> {
  const t = await token();
  if (!t) throw new Error("Necesitas iniciar sesión");

  const res = await fetch("/api/game/credits", {
    method: "POST",
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "sandboxPurchase", productId, ref }),
  });
  const json = (await res.json().catch(() => ({}))) as PurchaseResult & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json;
}

/** Devolución de una compra de prueba. Exige la referencia de la compra original. */
export async function refundCredits(purchaseRef: string, ref: string): Promise<RefundResult> {
  const t = await token();
  if (!t) throw new Error("Necesitas iniciar sesión");

  const res = await fetch("/api/game/credits", {
    method: "POST",
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "sandboxRefund", purchaseRef, ref }),
  });
  const json = (await res.json().catch(() => ({}))) as RefundResult & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json;
}
