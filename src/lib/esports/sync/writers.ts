/**
 * DRL ESPORTS SYNC — escritura en Supabase con service_role.
 *
 * Todas las operaciones son UPSERT idempotentes (re-sincronizar no duplica).
 * Reciben el cliente admin (`@/lib/supabase/admin`) inyectado para mantener las
 * funciones puras de configuración y fáciles de testear.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

async function upsert(sb: SupabaseClient, table: string, rows: Row[], onConflict: string) {
  if (!rows.length) return;
  const { error } = await sb.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`upsert ${table}: ${error.message}`);
}

export const upsertCircuits = (sb: SupabaseClient, rows: Row[]) => upsert(sb, "circuits", rows, "id");
export const upsertTeams = (sb: SupabaseClient, rows: Row[]) => upsert(sb, "teams", rows, "id");
/**
 * Alta de jugadores. Faltaba: `map_player_stats.player_id` y `player_stats.player_id` tienen
 * FK contra `players(id)`, así que sin este upsert cualquier scoreboard real es imposible de
 * escribir. Debe ejecutarse DESPUÉS de los equipos (`players.team_id` referencia `teams`).
 */
export const upsertPlayers = (sb: SupabaseClient, rows: Row[]) => upsert(sb, "players", rows, "id");
export const upsertEvent = (sb: SupabaseClient, row: Row) => upsert(sb, "events", [row], "id");
export const upsertMatches = (sb: SupabaseClient, rows: Row[]) => upsert(sb, "matches", rows, "id");
export const upsertMapStats = (sb: SupabaseClient, rows: Row[]) =>
  upsert(sb, "map_player_stats", rows, "match_map_id,player_id");
export const upsertPlayerStats = (sb: SupabaseClient, rows: Row[]) =>
  upsert(sb, "player_stats", rows, "match_id,player_id");

/** Upsert de fases; devuelve un mapa slug → id para enlazar partidos. */
export async function upsertStages(sb: SupabaseClient, eventId: string, rows: Row[]): Promise<Record<string, string>> {
  if (!rows.length) return {};
  const { data, error } = await sb.from("stages").upsert(rows, { onConflict: "event_id,slug" }).select("id,slug");
  if (error) throw new Error(`upsert stages: ${error.message}`);
  const map: Record<string, string> = {};
  for (const s of (data as { id: string; slug: string }[]) ?? []) map[s.slug] = s.id;
  return map;
}

/** Upsert de mapas de un partido; devuelve un mapa map_order → id. */
export async function upsertMatchMaps(sb: SupabaseClient, rows: Row[]): Promise<Record<number, string>> {
  if (!rows.length) return {};
  const { data, error } = await sb.from("match_maps").upsert(rows, { onConflict: "match_id,map_order" }).select("id,map_order");
  if (error) throw new Error(`upsert match_maps: ${error.message}`);
  const map: Record<number, string> = {};
  for (const m of (data as { id: string; map_order: number }[]) ?? []) map[m.map_order] = m.id;
  return map;
}

// ---- RPC de recálculo (agregación en la base de datos) ----
export async function recomputeStandings(sb: SupabaseClient, eventId: string) {
  const { error } = await sb.rpc("recompute_standings", { p_event_id: eventId });
  if (error) throw new Error(`recompute_standings: ${error.message}`);
}

export async function recomputeTeamStats(sb: SupabaseClient, teamId: string, eventId: string) {
  const { error } = await sb.rpc("recompute_team_stats", { p_team_id: teamId, p_event_id: eventId });
  if (error) throw new Error(`recompute_team_stats: ${error.message}`);
}

export async function recomputePlayerEventStats(sb: SupabaseClient, eventId: string) {
  const { error } = await sb.rpc("recompute_player_event_stats", { p_event_id: eventId });
  if (error) throw new Error(`recompute_player_event_stats: ${error.message}`);
}

/** Marca el estado de una entrada de sincronización (`sync_state`). */
export async function setSyncState(sb: SupabaseClient, id: string, patch: Row) {
  const { error } = await sb.from("sync_state").upsert({ id, ...patch, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(`sync_state ${id}: ${error.message}`);
}

/** Registra una incidencia en `notifications` (tabla del Data Engine, 0002). */
export async function logNotification(sb: SupabaseClient, level: string, code: string, message: string) {
  await sb.from("notifications").insert({ level, code, message });
}
