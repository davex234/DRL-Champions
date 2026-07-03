/**
 * POST /api/esports/sync — dispara la sincronización competitiva (servidor).
 *
 * Protegido por cabecera `x-sync-secret` contra `SYNC_SECRET`. Pensado para un
 * cron / edge schedule. Cuerpo opcional:
 *   { "source": "mock" | "vlr", "tournamentId"?: string }
 *
 * Requiere `SUPABASE_SERVICE_ROLE_KEY`. Si `source` es "vlr" necesita además
 * `NEXT_PUBLIC_VLR_API`; en caso contrario usa la fuente mock.
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { runCompetitiveSync, syncTournament } from "@/lib/esports/sync/orchestrator";
import { mockSource } from "@/lib/esports/sync/mock";
import { vlrSource, isVlrConfigured } from "@/lib/esports/sync/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.SYNC_SECRET;
  if (!secret || req.headers.get("x-sync-secret") !== secret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY no configurado" }, { status: 503 });
  }

  let body: { source?: string; tournamentId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // cuerpo vacío permitido
  }

  const source = body.source === "vlr" && isVlrConfigured() ? vlrSource : mockSource;

  try {
    if (body.tournamentId) {
      const result = await syncTournament(source, body.tournamentId, sb);
      return NextResponse.json({ source: source.id, result });
    }
    const results = await runCompetitiveSync({ source });
    return NextResponse.json({ source: source.id, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
