"use client";

/**
 * EL CICLO DE JUEGO — CAPA DE CLIENTE (Fase 10).
 *
 * Una sola lectura (`GET /api/game/loop`) que trae lo que el jugador puede hacer ahora.
 * Aquí no se calcula ni se decide nada: el ciclo lo resuelve el servidor, que es el único
 * que conoce sobres, predicciones pendientes, niveles reclamables y mazos válidos.
 *
 * Mismo patrón de autorización que el resto del producto: el token de Supabase en la
 * cabecera, jamás el identificador de usuario en la petición.
 */
import { getSupabase } from "@/lib/supabase/client";
import type { LoopView, LoopStep, LoopStepKind } from "@/server/services/loop";

export type { LoopView, LoopStep, LoopStepKind };

/**
 * Trae el ciclo. Devuelve `null` sin sesión —no es un error: el vestíbulo sin cuenta
 * simplemente no tiene un ciclo personal que enseñar— y lanza si el servidor falla.
 */
export async function fetchLoop(): Promise<LoopView | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;

  const res = await fetch("/api/game/loop", {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 401) return null;
  const json = (await res.json().catch(() => ({}))) as LoopView & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json;
}
