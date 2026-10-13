/**
 * `GET /api/game/me` — FASE 69 · EL PERFIL PROPIO, LEÍDO POR EL SERVIDOR. SOLO LECTURA.
 *
 * Hasta F69 el navegador leía su fila de `profiles` por REST (`select("*")`, y `is_admin` para el acceso de
 * administración). Eso obligaba a conceder a `authenticated` SELECT sobre TODAS las columnas, y la política de
 * `profiles` es «visible para todos»: con el registro abierto, cualquier cuenta podía leer créditos, XP, `is_admin`
 * y `last_seen_at` de cualquier otra. La migración 0058 (aplicada 2026-09-28, contrato en
 * docs/product/qa/fase69-hardening/profile-exposure.json) deja a `authenticated` solo las columnas públicas; las
 * privadas del propio jugador llegan por aquí, filtradas por el `userId` del Bearer (nunca por un parámetro).
 *
 * Funciona igual antes y después de 0058 (service_role). Sin sesión → 401. Errores → mensaje neutro con código.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { internalError } from "@/server/ops/log";
import { OWN_PROFILE_COLUMNS } from "@/lib/supabase/profileExposure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if ([...q.keys()].length > 0) return NextResponse.json({ error: "Parámetro no válido", code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });

  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });

  try {
    const { data, error } = await session.admin.from("profiles").select(OWN_PROFILE_COLUMNS.join(", ")).eq("id", session.userId).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ profile: data ?? null }, { status: 200, headers: NO_STORE });
  } catch (e) {
    return internalError("api/game/me", e, req);
  }
}
