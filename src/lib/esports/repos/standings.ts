"use client";

import { getSupabase } from "@/lib/supabase/client";
import type { StandingRow } from "@/lib/supabase/esports.types";
import type { Standing } from "@/domain/esports/types";
import { toStanding } from "./mappers";

/** Clasificación de un torneo, opcionalmente acotada a una fase. */
export async function getStandings(eventId: string, stageId?: string): Promise<Standing[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from("standings").select("*").eq("event_id", eventId).order("stage_key").order("position");
  if (stageId) q = q.eq("stage_id", stageId);
  const { data } = await q;
  return ((data as StandingRow[]) ?? []).map(toStanding);
}
