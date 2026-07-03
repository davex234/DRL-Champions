import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase con `service_role` — SOLO SERVIDOR.
 *
 * Salta RLS y puede escribir el catálogo deportivo (teams, events, matches,
 * stats, standings…) y ejecutar las RPC `recompute_*`. Úsalo exclusivamente en
 * código de servidor (route handlers, edge functions, scripts). NUNCA lo
 * importes en componentes de cliente: la service key no debe llegar al browser.
 *
 * No lleva la directiva "use client" (a diferencia de `client.ts`) por eso.
 */

function normalizeUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

const SUPABASE_URL = normalizeUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

let _admin: SupabaseClient | null = null;

/** ¿Está configurado el cliente admin (service role)? */
export function isAdminConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

/**
 * Devuelve el cliente service-role (singleton) o null si falta configuración.
 * Lanza si se invoca en el browser para evitar fugas de la clave.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (typeof window !== "undefined") {
    throw new Error("getSupabaseAdmin() es solo de servidor (no usar en cliente)");
  }
  if (!isAdminConfigured()) return null;
  if (!_admin) {
    _admin = createClient(SUPABASE_URL as string, SERVICE_KEY as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}
