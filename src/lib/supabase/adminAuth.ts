/**
 * Verificación de administrador para rutas de servidor (solo servidor).
 *
 * Lee el token Bearer de la petición (sesión de Supabase Auth del usuario),
 * resuelve el usuario y comprueba `profiles.is_admin` con el cliente service_role.
 * Devuelve el userId si es admin, o null en caso contrario.
 */
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./admin";

function normalizeUrl(raw: string | undefined): string | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  try { return new URL(t).origin; } catch { return t.replace(/\/+$/, ""); }
}

export async function verifyAdmin(req: Request): Promise<{ userId: string } | null> {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  const token = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  if (!token) return null;

  const url = normalizeUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const admin = getSupabaseAdmin();
  if (!url || !anon || !admin) return null;

  // Resuelve el usuario a partir de su JWT.
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  const userId = data.user?.id;
  if (error || !userId) return null;

  // Comprueba el flag de admin con service_role (salta RLS).
  const { data: profile } = await admin.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
  if (!profile?.is_admin) return null;
  return { userId };
}
