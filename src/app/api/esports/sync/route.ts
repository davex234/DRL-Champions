/**
 * POST /api/esports/sync — dispara la sincronización competitiva (servidor).
 *
 * Protegido por cabecera `x-sync-secret` contra `SYNC_SECRET`. Cuerpo opcional:
 *   { "source": "mock" | "vlr", "tournamentId"?: string, "dryRun"?: boolean }
 *
 * Requiere `SUPABASE_SERVICE_ROLE_KEY`.
 *
 * Fase 24.6 · `source: "vlr"` es el SYNC MANUAL sobre la fuente real y pasa por el mismo core que
 * el automático (`runEsportsSync`, modo `manual`): descubre los eventos VLR de la base de datos
 * (o solo `tournamentId`), valida, compara y escribe por el pipeline canónico. No acepta URLs.
 * `source: "mock"` (por defecto) conserva la fuente de desarrollo de siempre.
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { runCompetitiveSync, syncTournament } from "@/lib/esports/sync/orchestrator";
import { mockSource } from "@/lib/esports/sync/mock";
import { runEsportsSync } from "@/lib/esports/autosync/runner";
import { getEsportsAutoSyncConfig } from "@/lib/esports/autosync/config";
import { createConsoleLogger } from "@/lib/esports/autosync/log";
import { secretMatches } from "@/server/ops/secret";
import { internalError } from "@/server/ops/log";

const EVENT_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]|:){0,63}$/;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.SYNC_SECRET;
  if (!secretMatches(req.headers.get("x-sync-secret"), secret)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY no configurado" }, { status: 503 });
  }

  let body: { source?: string; tournamentId?: string; dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // cuerpo vacío permitido
  }

  if (body.tournamentId !== undefined && (typeof body.tournamentId !== "string" || !EVENT_ID.test(body.tournamentId))) {
    return NextResponse.json({ error: "tournamentId inválido" }, { status: 400 });
  }

  if (body.source === "vlr") {
    try {
      const result = await runEsportsSync(
        { sb, cfg: getEsportsAutoSyncConfig(), logger: createConsoleLogger() },
        { mode: "manual", dryRun: body.dryRun === true, eventIds: body.tournamentId ? [body.tournamentId] : undefined },
      );
      return NextResponse.json({ source: "vlr", result });
    } catch (e) {
      return internalError("api/esports/sync", e, req);
    }
  }

  const source = mockSource;

  try {
    if (body.tournamentId) {
      const result = await syncTournament(source, body.tournamentId, sb);
      return NextResponse.json({ source: source.id, result });
    }
    const results = await runCompetitiveSync({ source });
    return NextResponse.json({ source: source.id, results });
  } catch (e) {
    return internalError("api/esports/sync", e, req);
  }
}
