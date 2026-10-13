/**
 * COMPATIBILIDAD DE ESQUEMA PRE/POST-0045 (Fase 24.6).
 *
 * ────────────────────────── EL PROBLEMA ──────────────────────────
 *
 * La migración 0045 añade a `matches` las columnas de estructura del cuadro
 * (`winner_to_match_id`, `winner_qualifies`, `progression_confidence`…). Existe en el repo pero
 * NO está aplicada. Tres lectores y un escritor las nombraban en claro:
 *
 *   · `pickemLifecycle` (SELECT con `winner_qualifies…`)  → PostgREST responde 42703 y el ciclo
 *     entero de Pick'ems (preguntas, resolución, scoring) se quedaba sin ejecutar pre-0045.
 *   · `lib/game/client.fetchMatches` (SELECT en el navegador) → `/pickems` sin partidos.
 *   · `orchestrator.upsertMatchProgression` (UPSERT)      → el sync de un torneo con cuadro
 *     confirmado fallaba entero, no solo la estructura.
 *
 * ────────────────────────── LA REGLA ──────────────────────────
 *
 * Un esquema sin 0045 NO es un error: es el estado real de producción hasta que se aplique.
 * Todo lo que toque esas columnas debe degradar a «sin estructura» (24.3) y seguir. Este
 * módulo da las dos piezas: reconocer el error de columna ausente y sondear una sola vez si
 * las columnas existen. Sin migración nueva, sin `information_schema`: una lectura vacía.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Columnas que añade la 0045 (en el orden de la migración). */
export const PROGRESSION_COLUMNS = [
  "winner_to_match_id", "winner_to_slot", "loser_to_match_id", "loser_to_slot",
  "winner_qualifies", "winner_qualifies_label", "progression_evidence", "progression_confidence",
  "progression_version", "progression_synced_at",
] as const;

/** ¿Es un error de «columna inexistente» (PostgreSQL 42703 vía PostgREST)? */
export function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === "42703") return true;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return msg.includes("does not exist") && msg.includes("column");
}

/** Quita las columnas de la 0045 de una lista `select` separada por comas. */
export function withoutProgressionColumns(select: string): string {
  const drop = new Set<string>(PROGRESSION_COLUMNS);
  return select.split(",").map((c) => c.trim()).filter((c) => c && !drop.has(c)).join(", ");
}

const PROBE_TTL_MS = 5 * 60_000;
const probes = new WeakMap<object, { at: number; present: boolean }>();

/**
 * ¿Están aplicadas las columnas de la 0045? Sonda mínima (una fila, `head`) con caché de cinco
 * minutos por cliente: aplicar la migración se refleja sin reiniciar y sin sondear en cada
 * partido. Ante cualquier otro error se responde `true` y se deja que la operación real falle
 * con su mensaje de verdad — aquí solo se reconoce la ausencia de columna.
 */
export async function hasProgressionColumns(sb: SupabaseClient, now = Date.now()): Promise<boolean> {
  const cached = probes.get(sb);
  if (cached && now - cached.at < PROBE_TTL_MS) return cached.present;
  let present = true;
  try {
    const { error } = await sb.from("matches").select("winner_to_match_id").limit(1);
    if (error && isMissingColumnError(error)) present = false;
  } catch (e) {
    if (isMissingColumnError(e)) present = false;
  }
  probes.set(sb, { at: now, present });
  return present;
}

/** Olvida la sonda (tests y scripts que cambian de esquema en el mismo proceso). */
export function resetProgressionProbe(sb: SupabaseClient): void {
  probes.delete(sb);
}
