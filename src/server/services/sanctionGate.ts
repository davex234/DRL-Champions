/**
 * F58 · PUERTA DE SANCIONES (SOLO SERVIDOR) — la consulta que hace cumplir una sanción.
 *
 * Módulo ligero a propósito: lo importa `getSession` (todas las rutas del juego) y no debe arrastrar la capa HTTP del
 * panel. Las escrituras (emitir/revocar) viven en `server/admin/moderation.ts` e invalidan esta caché.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { governingSanction, type SanctionRow } from "@/domain/admin/sanctions";

/*
 * ────────────────────────── ENFORCEMENT: «¿tiene este usuario una sanción activa?» ──────────────────────────
 *
 * Se consulta en cada MUTACIÓN del juego, así que va con una caché corta en memoria del proceso (15 s). Emitir o
 * revocar desde este proceso la invalida al instante; desde otro proceso, como mucho tarda la TTL. Si la BD falla
 * se responde «sin sanción» (fallo abierto) SOLO para no tumbar el juego entero por una tabla: la sanción es una capa
 * más, no la única barrera de nada, y el error queda en el log.
 */
const TTL_MS = 15_000;
const cache = new Map<string, { at: number; sanction: Pick<SanctionRow, "type" | "expires_at"> | null }>();

export function invalidateSanctionCache(userId?: string): void {
  if (userId) cache.delete(userId); else cache.clear();
}

export async function activeSanctionFor(sb: SupabaseClient, userId: string, now = Date.now()): Promise<Pick<SanctionRow, "type" | "expires_at"> | null> {
  const hit = cache.get(userId);
  if (hit && now - hit.at < TTL_MS) return hit.sanction && governingSanction([{ ...hit.sanction, revoked_at: null }], now) ? hit.sanction : null;
  try {
    const { data, error } = await sb.from("user_sanctions").select("type, expires_at, revoked_at").eq("user_id", userId).is("revoked_at", null).limit(10);
    if (error) { console.error(`[sanctions] ${error.message}`); return null; }
    const g = governingSanction((data ?? []) as Pick<SanctionRow, "type" | "expires_at" | "revoked_at">[], now);
    const sanction = g ? { type: g.type, expires_at: g.expires_at } : null;
    cache.set(userId, { at: now, sanction });
    return sanction;
  } catch (e) {
    console.error(`[sanctions] ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
