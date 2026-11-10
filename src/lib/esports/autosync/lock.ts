/**
 * ESPORTS AUTO-SYNC · SINGLE-FLIGHT (Fase 24.6) — un sync global a la vez, con lease.
 *
 * ────────────────────────── POR QUÉ EN LA BASE DE DATOS ──────────────────────────
 *
 * Una variable de módulo solo protege dentro de UN proceso. Con dos instancias (o un cron que
 * dispara mientras otro sigue), dos syncs escribirían a la vez. El lock vive en `sync_state`
 * (tabla que ya existe, 0003) como una fila con lease: `status='running'` + dueño en `cursor` +
 * `updated_at` como inicio del lease. La adquisición es UN solo UPDATE condicional — atómico en
 * PostgreSQL — que solo gana si nadie lo tiene o si el lease ha caducado.
 *
 * Sin Redis, sin advisory locks de sesión (no sobreviven al pool de PostgREST), sin migración.
 *
 * ────────────────────────── EXPIRACIÓN ──────────────────────────
 *
 * Si el proceso muere con el lock, nadie lo libera. Por eso es un lease: pasado `ttlMs` desde
 * `updated_at`, otro sync puede entrar y lo hace constar (`recoveredStale`). El TTL debe ser
 * mayor que la duración normal de una pasada: por defecto 10 minutos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const LOCK_STATE_ID = "esports:autosync:lock";

export type LockOutcome =
  | { acquired: true; recoveredStale: boolean }
  | { acquired: false; holder: string | null; heldSince: string | null };

export interface SyncLock {
  acquire(owner: string, ttlMs: number, now: number): Promise<LockOutcome>;
  release(owner: string): Promise<void>;
}

interface LockRow { id: string; status: string; cursor: string | null; updated_at: string | null }

/** Lock por lease sobre `sync_state`. */
export function createDbLeaseLock(sb: SupabaseClient): SyncLock {
  return {
    async acquire(owner, ttlMs, now) {
      // La fila existe desde el primer intento; `ignoreDuplicates` no pisa una en uso.
      const seed = await sb.from("sync_state")
        .upsert({ id: LOCK_STATE_ID, status: "idle", cursor: null, error: null, updated_at: new Date(now).toISOString() }, { onConflict: "id", ignoreDuplicates: true });
      if (seed.error) throw new Error(`lock seed: ${seed.error.message}`);

      const before = await sb.from("sync_state").select("id, status, cursor, updated_at").eq("id", LOCK_STATE_ID).maybeSingle();
      if (before.error) throw new Error(`lock read: ${before.error.message}`);
      const prev = (before.data ?? null) as LockRow | null;
      const expiredBefore = new Date(now - ttlMs).toISOString();

      /*
       * UPDATE … WHERE id = lock AND (status <> 'running' OR updated_at < now - ttl)
       * Devuelve la fila solo si el UPDATE la tocó: eso es «he ganado». Dos procesos a la vez:
       * uno gana, el otro ve 0 filas.
       */
      const won = await sb.from("sync_state")
        .update({ status: "running", cursor: owner, error: null, updated_at: new Date(now).toISOString() })
        .eq("id", LOCK_STATE_ID)
        .or(`status.neq.running,updated_at.lt.${expiredBefore}`)
        .select("id");
      if (won.error) throw new Error(`lock acquire: ${won.error.message}`);
      const rows = (won.data ?? []) as { id: string }[];
      if (rows.length === 1) {
        return { acquired: true, recoveredStale: prev?.status === "running" };
      }
      return { acquired: false, holder: prev?.cursor ?? null, heldSince: prev?.updated_at ?? null };
    },
    async release(owner) {
      // Solo el dueño libera. Un lease ya robado por caducidad no se toca.
      const { error } = await sb.from("sync_state")
        .update({ status: "idle", cursor: null })
        .eq("id", LOCK_STATE_ID)
        .eq("cursor", owner);
      if (error) throw new Error(`lock release: ${error.message}`);
    },
  };
}

/** Lock en memoria con lease (tests, scripts de un solo proceso). Misma semántica. */
export function createMemoryLock(): SyncLock & { holder: () => string | null } {
  let holder: string | null = null;
  let since = 0;
  let ttl = 0;
  return {
    holder: () => holder,
    async acquire(owner, ttlMs, now) {
      if (holder && holder !== owner && now - since < ttl) {
        return { acquired: false, holder, heldSince: new Date(since).toISOString() };
      }
      const recoveredStale = holder !== null && holder !== owner;
      holder = owner; since = now; ttl = ttlMs;
      return { acquired: true, recoveredStale };
    },
    async release(owner) {
      if (holder === owner) { holder = null; since = 0; ttl = 0; }
    },
  };
}
