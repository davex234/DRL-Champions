"use client";

import { getSupabase } from "@/lib/supabase/client";
import type { TeamStatsRow, PlayerEventStatsRow } from "@/lib/supabase/esports.types";
import type { TeamStats, PlayerEventStats } from "@/domain/esports/types";
import { toTeamStats, toPlayerEventStats } from "./mappers";

/** Estadísticas agregadas de un equipo (por torneo o globales). */
export async function getTeamStats(teamId: string, opts: { eventId?: string; scope?: string } = {}): Promise<TeamStats[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from("team_stats").select("*").eq("team_id", teamId);
  if (opts.eventId) q = q.eq("event_id", opts.eventId);
  if (opts.scope) q = q.eq("scope", opts.scope);
  const { data } = await q;
  return ((data as TeamStatsRow[]) ?? []).map(toTeamStats);
}

/** Clasificación individual (leaderboard) de un torneo, ordenada por rating. */
export async function getPlayerLeaderboard(eventId: string, limit = 50): Promise<PlayerEventStats[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("player_event_stats")
    .select("*")
    .eq("event_id", eventId)
    .order("rating", { ascending: false, nullsFirst: false })
    .limit(limit);
  return ((data as PlayerEventStatsRow[]) ?? []).map(toPlayerEventStats);
}
