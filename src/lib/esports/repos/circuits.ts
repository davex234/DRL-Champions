"use client";

import { getSupabase } from "@/lib/supabase/client";
import type { CircuitRow } from "@/lib/supabase/esports.types";
import type { Circuit, CircuitTier } from "@/domain/esports/types";
import { toCircuit } from "./mappers";

/** Lista de circuitos, opcionalmente filtrada por tier. */
export async function listCircuits(tier?: CircuitTier): Promise<Circuit[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from("circuits").select("*").order("tier");
  if (tier) q = q.eq("tier", tier);
  const { data } = await q;
  return ((data as CircuitRow[]) ?? []).map(toCircuit);
}

export async function getCircuit(id: string): Promise<Circuit | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("circuits").select("*").eq("id", id).maybeSingle();
  return data ? toCircuit(data as CircuitRow) : null;
}
