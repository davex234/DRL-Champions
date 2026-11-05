"use client";

import { getSupabase } from "@/lib/supabase/client";
import type {
  MatchRow, MatchMapRow, MapPlayerStatRow, PlayerStatRow,
} from "@/lib/supabase/esports.types";
import type {
  Match, MatchMap, MapPlayerStat, PlayerMatchStat,
} from "@/domain/esports/types";
import { toMatch, toMatchMap, toMapPlayerStat, toPlayerMatchStat } from "./mappers";

/** Próximos partidos (upcoming + live) ordenados por hora de inicio. */
export async function listUpcoming(limit = 50): Promise<Match[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("matches")
    .select("*")
    .in("status", ["upcoming", "live"])
    .order("start_time", { ascending: true })
    .limit(limit);
  return ((data as MatchRow[]) ?? []).map(toMatch);
}

/** Resultados recientes (finished) ordenados por hora descendente. */
export async function listResults(opts: { eventId?: string; limit?: number } = {}): Promise<Match[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from("matches").select("*").eq("status", "finished").order("start_time", { ascending: false }).limit(opts.limit ?? 50);
  if (opts.eventId) q = q.eq("event_id", opts.eventId);
  const { data } = await q;
  return ((data as MatchRow[]) ?? []).map(toMatch);
}

export async function listMatchesByEvent(eventId: string): Promise<Match[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("matches").select("*").eq("event_id", eventId).order("start_time");
  return ((data as MatchRow[]) ?? []).map(toMatch);
}

export async function getMatch(id: string): Promise<Match | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("matches").select("*").eq("id", id).maybeSingle();
  return data ? toMatch(data as MatchRow) : null;
}

export async function listMatchMaps(matchId: string): Promise<MatchMap[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("match_maps").select("*").eq("match_id", matchId).order("map_order");
  return ((data as MatchMapRow[]) ?? []).map(toMatchMap);
}

/** Scoreboard granular (por mapa) de un partido. */
export async function listMapPlayerStats(matchId: string): Promise<MapPlayerStat[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("map_player_stats").select("*").eq("match_id", matchId);
  return ((data as MapPlayerStatRow[]) ?? []).map(toMapPlayerStat);
}

/** Estadística agregada por partido y jugador (tabla `player_stats`). */
export async function listMatchPlayerStats(matchId: string): Promise<PlayerMatchStat[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("player_stats").select("*").eq("match_id", matchId);
  return ((data as PlayerStatRow[]) ?? []).map(toPlayerMatchStat);
}
