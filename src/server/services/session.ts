/**
 * Resolución de sesión para las rutas de servidor (SOLO SERVIDOR).
 *
 * Mismo modelo que `lib/supabase/adminAuth.ts`, pero para usuarios normales: lee el
 * Bearer de Supabase Auth, resuelve el usuario contra GoTrue y devuelve su id. El
 * cliente NUNCA envía su `userId` en el cuerpo — se deriva del token, porque un
 * `userId` en el body es exactamente el vector que permite operar en nombre de otro.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { serverSupabaseFetch } from "@/lib/supabase/serverUrl";
import { isGatedRequest } from "@/domain/admin/sanctions";
import { activeSanctionFor } from "./sanctionGate";

function normalizeUrl(raw: string | undefined): string | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  try { return new URL(t).origin; } catch { return t.replace(/\/+$/, ""); }
}

export interface Session {
  userId: string;
  /** Cliente service_role para operar en servidor (salta RLS). */
  admin: SupabaseClient;
  /**
   * F63 · `app_metadata` del usuario tal como lo devolvió GoTrue al validar el token (lectura fresca de la BD de auth,
   * sin petición extra). Solo lo escribe el servidor con service_role; ahí viven los acuses del onboarding.
   */
  appMetadata?: Record<string, unknown>;
}

/** Extrae el token Bearer de la petición. */
export function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;
  const t = auth.slice(7).trim();
  return t.length > 0 ? t : null;
}

/**
 * Devuelve la sesión del usuario autenticado, o `null`.
 * Falla cerrado: sin configuración de servidor no se resuelve ninguna sesión.
 */
export async function getSession(req: Request): Promise<Session | null> {
  const token = bearerToken(req);
  if (!token) return null;

  const url = normalizeUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const admin = getSupabaseAdmin();
  if (!url || !anon || !admin) return null;

  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: serverSupabaseFetch } });
  const { data, error } = await client.auth.getUser(token);
  const userId = data.user?.id;
  if (error || !userId) return null;

  /*
   * F58 · ENFORCEMENT DE SANCIONES. Una cuenta con sanción activa (ban o suspensión, `user_sanctions`) no obtiene
   * sesión para ninguna MUTACIÓN del juego: comprar/abrir, desguazar, reclamar, jugar, matchmaking, competitivo,
   * social, mercado, pick'ems… Las lecturas (GET) y la telemetría siguen. Se decide aquí porque es el único punto que
   * TODAS las rutas del juego atraviesan con la identidad ya verificada. El middleware responde antes un 403 legible;
   * esto es la autoridad aunque alguien se salte el borde.
   */
  if (isGatedRequest(req.method, pathOf(req)) && await activeSanctionFor(admin, userId)) return null;

  return { userId, admin, appMetadata: (data.user?.app_metadata ?? {}) as Record<string, unknown> };
}

function pathOf(req: Request): string {
  try { return new URL(req.url).pathname; } catch { return ""; }
}
