/**
 * TRIGGER INTERNO DEL SYNC ESPORTS (Fase 24.6, SOLO SERVIDOR).
 *
 *   POST /api/internal/esports/sync
 *     Authorization: Bearer <SYNC_SECRET>      (o cabecera x-sync-secret, como /api/esports/sync)
 *     { "mode"?: "scheduled" | "manual", "dryRun"?: boolean, "eventIds"?: string[], "pickems"?: boolean }
 *
 * ────────────────────────── FALLA CERRADO ──────────────────────────
 *
 *   sin secreto configurado        → 503, no se ejecuta nada
 *   sin credencial o incorrecta    → 401, no se ejecuta nada (ni se dice cuál de las dos)
 *   scheduled con kill switch OFF  → 200 { skipped: "disabled" }: el cron puede seguir llamando,
 *                                    no pasa nada hasta que alguien active la automatización
 *
 * ────────────────────────── NO ACEPTA URLs ──────────────────────────
 *
 * El cuerpo solo puede nombrar eventos de NEXUS por id (y validado). Un cuerpo con `url`,
 * `targets` o `source` es un 400: la fuente la decide el servidor, no quien llama.
 *
 * La lógica vive aquí y no en la ruta para poder probarla sin Next: la ruta solo cablea.
 */
import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEsportsAutoSyncConfig, getSyncTriggerSecret, type EnvLike } from "@/lib/esports/autosync/config";
import type { EsportsSyncRunResult, RunDeps, RunOptions } from "@/lib/esports/autosync/runner";
import { createConsoleLogger, type SyncLogger } from "@/lib/esports/autosync/log";
import { bearerToken } from "./session";

export interface TriggerDeps {
  env: EnvLike;
  sb: SupabaseClient | null;
  run: (deps: RunDeps, opts: RunOptions) => Promise<EsportsSyncRunResult>;
  logger?: SyncLogger;
}

const NO_STORE = { "cache-control": "no-store", "content-type": "application/json" };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: NO_STORE });

// Sin «:» dentro de corchetes: Tailwind escanea src/ y lo tomaría por una clase arbitraria.
const EVENT_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]|:){0,63}$/;
const FORBIDDEN_KEYS = ["url", "urls", "targets", "source", "sourceUrl", "vlrUrl", "fetch"];

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function handleSyncTrigger(req: Request, deps: TriggerDeps): Promise<Response> {
  const secret = getSyncTriggerSecret(deps.env);
  if (!secret) return json({ error: "Trigger no configurado" }, 503);

  const provided = bearerToken(req) ?? req.headers.get("x-sync-secret")?.trim() ?? null;
  if (!provided || !secretsMatch(provided, secret)) return json({ error: "No autorizado" }, 401);

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return json({ error: "Cuerpo JSON ilegible" }, 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return json({ error: "Cuerpo inválido" }, 400);
  for (const k of FORBIDDEN_KEYS) {
    if (k in body) return json({ error: `El trigger no acepta «${k}»: la fuente la decide el servidor` }, 400);
  }

  const mode = body.mode === "manual" ? "manual" : "scheduled";
  const dryRun = body.dryRun === true;
  const pickems = body.pickems === false ? false : undefined;
  let eventIds: string[] | undefined;
  if (body.eventIds !== undefined) {
    if (!Array.isArray(body.eventIds) || body.eventIds.length > 20) return json({ error: "eventIds inválido" }, 400);
    eventIds = [];
    for (const id of body.eventIds) {
      if (typeof id !== "string" || !EVENT_ID.test(id)) return json({ error: "eventIds inválido" }, 400);
      eventIds.push(id);
    }
  }

  const cfg = getEsportsAutoSyncConfig(deps.env);
  if (mode === "scheduled" && !cfg.enabled) {
    return json({ skipped: "disabled", enabled: false, mode, dryRun });
  }
  if (!deps.sb) return json({ error: "Supabase admin no configurado" }, 503);

  try {
    const result = await deps.run(
      { sb: deps.sb, cfg, logger: deps.logger ?? createConsoleLogger() },
      { mode, dryRun, eventIds, pickems },
    );
    return json({ enabled: cfg.enabled, result });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Sync fallido" }, 500);
  }
}
