"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Normaliza la URL del proyecto al ORIGEN limpio (https://<ref>.supabase.co).
 *
 * El SDK construye los endpoints con `new URL("auth/v1", baseUrl)`, que conserva
 * cualquier path que traiga el valor. Si en Vercel se pega la URL con una barra
 * final + espacios, una doble barra, o una ruta sobrante (p. ej. ".../auth/v1"
 * o ".../rest/v1"), el endpoint resultante queda como ".../rest/v1/auth/v1/signup"
 * y el gateway de Supabase responde "Invalid path specified in request URL".
 * Quedarnos con el origen elimina ese fallo sea cual sea el formato pegado.
 */
function normalizeSupabaseUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).origin;
  } catch {
    // Si no es una URL parseable, al menos quitamos barras/espacios finales.
    return trimmed.replace(/\/+$/, "");
  }
}

const SUPABASE_URL = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

let _client: SupabaseClient | null = null;

/** ¿Está configurado Supabase? Si no, el juego funciona en modo local. */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && ANON);
}

/** Cliente Supabase (singleton). Devuelve null si no está configurado. */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!_client) {
    _client = createClient(SUPABASE_URL as string, ANON as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return _client;
}
