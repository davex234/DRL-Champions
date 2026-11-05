"use client";

/**
 * F83 · RUTA DE TEMPORADA — CLIENTE. Transporte hacia `/api/game/season-track`: el cliente no calcula nada (ni XP, ni
 * nivel, ni retos). `useSeasonTrack` ata la foto a la CUENTA que la pidió (cambiar de cuenta nunca enseña la de otra) y
 * vuelve a leer al volver a la pestaña (una pestaña abierta durante el reinicio diario ve la rotación nueva).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { SeasonOverview } from "@/domain/seasonTrack/view";
import type { SeasonReward } from "@/domain/seasonTrack/types";

export type { SeasonOverview };

export class SeasonError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = "SeasonError"; }
}

async function auth(json = false): Promise<Record<string, string>> {
  const out: Record<string, string> = json ? { "content-type": "application/json" } : {};
  const { data } = (await getSupabase()?.auth.getSession()) ?? { data: { session: null } };
  if (data.session?.access_token) out.authorization = `Bearer ${data.session.access_token}`;
  return out;
}
async function parse<T>(res: Response): Promise<T> {
  const j = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new SeasonError(j.error ?? `Error ${res.status}`, res.status, j.code);
  return j;
}

export async function fetchSeasonTrack(): Promise<SeasonOverview> {
  return parse(await fetch("/api/game/season-track", { headers: await auth(), cache: "no-store" }));
}

export interface ClaimOut { seasonId: string; level: number; outcome: "CLAIMED" | "ALREADY"; reward: SeasonReward; overview: SeasonOverview | null }
export async function claimSeasonReward(seasonId: string, level: number): Promise<ClaimOut> {
  return parse(await fetch("/api/game/season-track", { method: "POST", headers: await auth(true), body: JSON.stringify({ action: "claim", seasonId, level }) }));
}

/** Foto de la ruta atada a `userId` (null = sin sesión: no se pide nada). */
export function useSeasonTrack(userId: string | null) {
  const [state, setState] = useState<{ key: string | null; data: SeasonOverview | null; error: SeasonError | null; loading: boolean }>({ key: null, data: null, error: null, loading: !!userId });
  const keyRef = useRef(userId);
  keyRef.current = userId;
  const load = useCallback(async () => {
    const key = keyRef.current;
    if (!key) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fetchSeasonTrack();
      if (keyRef.current === key) setState({ key, data, error: null, loading: false });
    } catch (e) {
      if (keyRef.current === key) setState((s) => ({ key, data: s.key === key ? s.data : null, error: e instanceof SeasonError ? e : new SeasonError("No se pudo leer la temporada", 500), loading: false }));
    }
  }, []);
  useEffect(() => { if (userId) void load(); }, [userId, load]);
  useEffect(() => {
    if (!userId) return;
    const onVis = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [userId, load]);
  // Solo se entrega la foto de ESTA cuenta (la de otra, aunque esté en memoria, no se pinta ni un instante).
  const mine = state.key === userId;
  const setData = useCallback((data: SeasonOverview) => setState((s) => (s.key === keyRef.current ? { ...s, data } : s)), []);
  return { data: mine ? state.data : null, error: mine ? state.error : null, loading: !mine || state.loading, reload: load, setData };
}
