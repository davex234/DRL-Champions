"use client";

import { getSupabase } from "@/lib/supabase/client";
import type { TeamRow, PlayerRow } from "@/lib/supabase/esports.types";
import type { ProTeam, ProPlayer } from "@/domain/esports/types";
import { toTeam, toPlayer } from "./mappers";

export async function listTeams(opts: { region?: string; activeOnly?: boolean } = {}): Promise<ProTeam[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from("teams").select("*").order("world_ranking", { ascending: true, nullsFirst: false });
  if (opts.region) q = q.eq("region", opts.region);
  if (opts.activeOnly) q = q.eq("active", true);
  const { data } = await q;
  return ((data as TeamRow[]) ?? []).map(toTeam);
}

export async function getTeam(id: string): Promise<ProTeam | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("teams").select("*").eq("id", id).maybeSingle();
  return data ? toTeam(data as TeamRow) : null;
}

/** Plantilla activa de un equipo. */
export async function listTeamRoster(teamId: string): Promise<ProPlayer[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("players").select("*").eq("team_id", teamId).order("is_substitute");
  return ((data as PlayerRow[]) ?? []).map(toPlayer);
}
