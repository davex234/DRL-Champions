"use client";

import { getSupabase } from "@/lib/supabase/client";
import type { EventRow, StageRow } from "@/lib/supabase/esports.types";
import type { Tournament, Stage } from "@/domain/esports/types";
import { toTournament, toStage } from "./mappers";

/** Torneos (tabla `events`), filtrables por circuito o estado. */
export async function listTournaments(opts: { circuitId?: string; status?: string; limit?: number } = {}): Promise<Tournament[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from("events").select("*").order("start_date", { ascending: false }).limit(opts.limit ?? 100);
  if (opts.circuitId) q = q.eq("circuit_id", opts.circuitId);
  if (opts.status) q = q.eq("status", opts.status);
  const { data } = await q;
  return ((data as EventRow[]) ?? []).map(toTournament);
}

export async function getTournament(id: string): Promise<Tournament | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("events").select("*").eq("id", id).maybeSingle();
  return data ? toTournament(data as EventRow) : null;
}

export async function listStages(eventId: string): Promise<Stage[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("stages").select("*").eq("event_id", eventId).order("order_idx");
  return ((data as StageRow[]) ?? []).map(toStage);
}
