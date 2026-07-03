/**
 * POST /api/esports/predict — ejecuta la IA de análisis competitivo (servidor).
 *
 * Protegido por la cabecera `x-sync-secret` (env `SYNC_SECRET`). Cuerpo:
 *   { "mode": "ratings" | "match" | "upcoming",
 *     "matchId"?: string,
 *     "provider"?: "auto" | "claude" | "heuristic" }
 *
 * - ratings:  recomputa los Elo (`team_ratings`) desde los partidos finalizados.
 * - match:    predice un partido concreto (requiere matchId).
 * - upcoming: predice todos los próximos/en vivo (lote).
 *
 * Requiere `SUPABASE_SERVICE_ROLE_KEY`. La IA usa Claude si hay `ANTHROPIC_API_KEY`,
 * si no el proveedor heurístico.
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { rebuildRatings, predictMatch, predictUpcoming } from "@/lib/esports/predict/engine";
import type { ProviderChoice } from "@/lib/esports/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.SYNC_SECRET;
  if (!secret || req.headers.get("x-sync-secret") !== secret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY no configurado" }, { status: 503 });

  let body: { mode?: string; matchId?: string; provider?: ProviderChoice } = {};
  try { body = await req.json(); } catch { /* cuerpo vacío permitido */ }
  const provider: ProviderChoice = body.provider ?? "auto";

  try {
    if (body.mode === "ratings") {
      return NextResponse.json({ mode: "ratings", result: await rebuildRatings(sb) });
    }
    if (body.mode === "match") {
      if (!body.matchId) return NextResponse.json({ error: "matchId requerido" }, { status: 400 });
      return NextResponse.json({ mode: "match", result: await predictMatch(sb, body.matchId, provider) });
    }
    if (body.mode === "upcoming") {
      return NextResponse.json({ mode: "upcoming", results: await predictUpcoming(sb, provider) });
    }
    return NextResponse.json({ error: "mode debe ser 'ratings' | 'match' | 'upcoming'" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
