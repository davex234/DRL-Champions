"use client";

import { getSupabase } from "@/lib/supabase/client";
import type { PlayerRow } from "@/lib/supabase/esports.types";
import type { ProPlayer } from "@/domain/esports/types";
import { toPlayer } from "./mappers";

export async function listPlayers(opts: { region?: string; teamId?: string; limit?: number } = {}): Promise<ProPlayer[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from("players").select("*").order("nick").limit(opts.limit ?? 200);
  if (opts.region) q = q.eq("region", opts.region);
  if (opts.teamId) q = q.eq("team_id", opts.teamId);
  const { data } = await q;
  return ((data as PlayerRow[]) ?? []).map(toPlayer);
}

export async function getPlayer(id: string): Promise<ProPlayer | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("players").select("*").eq("id", id).maybeSingle();
  return data ? toPlayer(data as PlayerRow) : null;
}
