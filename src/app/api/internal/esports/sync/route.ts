/**
 * POST /api/internal/esports/sync — trigger PROTEGIDO del sync esports (Fase 24.6).
 *
 * Pensado para un cron / systemd timer / scheduler del hosting: llama aquí con
 * `Authorization: Bearer <SYNC_SECRET>` y el core decide qué eventos tocan. Con el kill switch
 * apagado (`ESPORTS_AUTO_SYNC_ENABLED` ausente o `false`) responde `{ skipped: "disabled" }` sin
 * ejecutar nada. Toda la lógica —y sus pruebas— vive en `services/esportsSyncTrigger`.
 */
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { runEsportsSync } from "@/lib/esports/autosync/runner";
import { handleSyncTrigger } from "@/server/services/esportsSyncTrigger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleSyncTrigger(req, { env: process.env, sb: getSupabaseAdmin(), run: runEsportsSync });
}
