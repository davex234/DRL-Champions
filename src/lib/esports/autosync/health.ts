/**
 * ESPORTS AUTO-SYNC · SALUD DEL PIPELINE (Fase 24.6).
 *
 * Estado mínimo que Operations puede leer: último intento, último éxito, duración, resultado,
 * fallos consecutivos y la memoria por evento que necesita la política (último intento y fallos
 * por evento). Se persiste en `sync_state` (0003) en la fila `esports:autosync`:
 *
 *   status          ok | error | idle
 *   last_synced_at  último ÉXITO
 *   updated_at      último INTENTO
 *   error           último error (sin secretos)
 *   cursor          JSON con el resto (duración, resumen, fallos, memoria por evento)
 *
 * Sin tabla nueva ni migración: la columna `cursor` es texto libre pensado para «estado de
 * sincronización», y esto es exactamente eso. Si un día crece, se le da tabla propia (P2).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventSyncMemory } from "./policy";

export const HEALTH_STATE_ID = "esports:autosync";

/** Resumen compacto de una pasada (lo que cabe en la salud sin duplicar el resultado entero). */
export interface SyncRunSummary {
  runId: string;
  mode: "manual" | "scheduled";
  dryRun: boolean;
  /** Fase 24.8 · origen de la ejecución (`worker-vps`, `pc-manual`…), si el trigger lo declara. */
  origin?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  eventsChecked: number;
  eventsSynced: number;
  eventsChanged: number;
  eventsFailed: number;
  matchesChanged: number;
  matchesFinished: number;
  pickemsScored: number;
  errors: string[];
}

export interface EsportsSyncHealth {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastDurationMs: number | null;
  lastStatus: "ok" | "error" | "skipped" | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastResult: SyncRunSummary | null;
  /** Memoria por evento para la política (último intento/éxito, fallos consecutivos). */
  events: Record<string, EventSyncMemory>;
  /** Próxima ejecución prevista por la política, si se sabe. */
  nextDueAt: string | null;
}

export const EMPTY_HEALTH: EsportsSyncHealth = {
  lastAttemptAt: null, lastSuccessAt: null, lastDurationMs: null, lastStatus: null, lastError: null,
  consecutiveFailures: 0, lastResult: null, events: {}, nextDueAt: null,
};

interface HealthRow { status: string; last_synced_at: string | null; error: string | null; updated_at: string | null; cursor: string | null }

/** Lee la salud. Nunca lanza: sin fila o con JSON roto devuelve el estado vacío. */
export async function readHealth(sb: SupabaseClient): Promise<EsportsSyncHealth> {
  try {
    const { data, error } = await sb.from("sync_state")
      .select("status, last_synced_at, error, updated_at, cursor")
      .eq("id", HEALTH_STATE_ID).maybeSingle();
    if (error || !data) return { ...EMPTY_HEALTH, events: {} };
    const row = data as HealthRow;
    let extra: Partial<EsportsSyncHealth> = {};
    if (row.cursor) {
      try { extra = JSON.parse(row.cursor) as Partial<EsportsSyncHealth>; } catch { extra = {}; }
    }
    return {
      lastAttemptAt: row.updated_at ?? null,
      lastSuccessAt: row.last_synced_at ?? null,
      lastDurationMs: extra.lastDurationMs ?? null,
      lastStatus: row.status === "ok" ? "ok" : row.status === "error" ? "error" : extra.lastStatus ?? null,
      lastError: row.error ?? null,
      consecutiveFailures: extra.consecutiveFailures ?? 0,
      lastResult: extra.lastResult ?? null,
      events: extra.events ?? {},
      nextDueAt: extra.nextDueAt ?? null,
    };
  } catch {
    return { ...EMPTY_HEALTH, events: {} };
  }
}

const MEMORY_RETENTION_MS = 30 * 24 * 3600_000;

/** Salud siguiente a partir de la anterior y del resumen de la pasada. Puro. */
export function nextHealth(prev: EsportsSyncHealth, run: SyncRunSummary, perEvent: Record<string, EventSyncMemory>, nextDueAt: number | null): EsportsSyncHealth {
  const failed = run.eventsFailed > 0 && run.eventsSynced === 0 && run.eventsChecked > 0 || run.errors.some((e) => e.startsWith("SYNC_FAILED"));
  const now = Date.parse(run.finishedAt);
  const events: Record<string, EventSyncMemory> = {};
  for (const [id, m] of Object.entries({ ...prev.events, ...perEvent })) {
    const last = m.lastAttemptAt ?? m.lastSuccessAt ?? null;
    if (last !== null && now - last > MEMORY_RETENTION_MS) continue;
    events[id] = m;
  }
  return {
    lastAttemptAt: run.finishedAt,
    lastSuccessAt: failed ? prev.lastSuccessAt : run.finishedAt,
    lastDurationMs: run.durationMs,
    lastStatus: failed ? "error" : "ok",
    lastError: failed ? run.errors[0] ?? "sync failed" : null,
    consecutiveFailures: failed ? prev.consecutiveFailures + 1 : 0,
    lastResult: run,
    events,
    nextDueAt: nextDueAt === null ? null : new Date(nextDueAt).toISOString(),
  };
}

/** Persiste la salud. Un fallo aquí no debe tumbar el sync: el llamador lo registra y sigue. */
export async function writeHealth(sb: SupabaseClient, h: EsportsSyncHealth): Promise<void> {
  const { lastAttemptAt, lastSuccessAt, lastError, lastStatus, ...rest } = h;
  const { error } = await sb.from("sync_state").upsert({
    id: HEALTH_STATE_ID,
    status: lastStatus === "error" ? "error" : lastStatus === "ok" ? "ok" : "idle",
    last_synced_at: lastSuccessAt,
    error: lastError,
    updated_at: lastAttemptAt ?? new Date().toISOString(),
    cursor: JSON.stringify({ ...rest, lastStatus }),
  }, { onConflict: "id" });
  if (error) throw new Error(`health: ${error.message}`);
}
