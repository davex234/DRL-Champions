/**
 * F67 · READINESS — ¿puede este proceso atender tráfico? Configuración, base de datos, esquema esperado y catálogo.
 * 200 si `ready`/`degraded`, 503 si `not_ready`. Cacheado 15 s en proceso: no se puede usar para cargar la BD.
 */
import { NextResponse } from "next/server";
import { cachedReadiness, readiness } from "@/server/ops/health";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { CARDS } from "@/data/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const r = await cachedReadiness(() => readiness(getSupabaseAdmin(), { cards: CARDS.length }));
  return NextResponse.json(r, { status: r.status === "not_ready" ? 503 : 200, headers: { "cache-control": "no-store" } });
}
