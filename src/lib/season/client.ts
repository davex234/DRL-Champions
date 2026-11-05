"use client";

/**
 * TEMPORADA — CLIENTE (Fase 34).
 *
 *   · `fetchSeasonHub` / `fetchSeasonCalendar` → `GET /api/game/season` (con Bearer si hay sesión).
 *   · `useSeasonHub`       → carga, error, refresco manual y reloj de servidor (`ServerClock`).
 *   · `useServerNow`       → estimación del reloj del servidor entre refrescos (nunca `Date.now()` a pelo).
 *   · `useCountdown`       → cuenta atrás hacia un instante del servidor; al cruzar 0 pide UNA foto nueva.
 *
 * El cliente no decide estado, transición, reclamos ni recompensas: el servidor manda y aquí se pinta.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { SeasonCalendarSnapshot, SeasonHubSnapshot } from "@/server/services/season";
import { countdown, crossedZero, estimateServerNow, tickMs, type Countdown, type ServerClock } from "@/domain/season/time";

export type { SeasonCalendarSnapshot, SeasonHubSnapshot };

export class SeasonError extends Error {
  constructor(message: string, public status: number, public code: string | null) { super(message); }
}

async function authHeader(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) return {};
  const token = (await sb.auth.getSession()).data.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function get<T>(path: string): Promise<{ data: T; clock: ServerClock }> {
  const res = await fetch(path, { headers: await authHeader(), cache: "no-store" });
  const receivedAt = Date.now();
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string; serverNow?: number };
  if (!res.ok) throw new SeasonError(json.error ?? "No se pudo leer la temporada", res.status, json.code ?? null);
  return { data: json, clock: { serverNow: typeof json.serverNow === "number" ? json.serverNow : receivedAt, receivedAt } };
}

export const fetchSeasonHub = (season?: string | null) =>
  get<SeasonHubSnapshot>(season ? `/api/game/season?season=${encodeURIComponent(season)}` : "/api/game/season");

export const fetchSeasonCalendar = () => get<SeasonCalendarSnapshot>("/api/game/season?scope=calendar");

export function useSeasonHub(season?: string | null, enabled = true) {
  const [snap, setSnap] = useState<SeasonHubSnapshot | null>(null);
  const [clock, setClock] = useState<ServerClock | null>(null);
  const [error, setError] = useState<SeasonError | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!enabled) return;
    setError(null);
    try {
      const r = await fetchSeasonHub(season);
      setSnap(r.data); setClock(r.clock);
    } catch (e) {
      setError(e instanceof SeasonError ? e : new SeasonError("No se pudo leer la temporada", 500, null));
    } finally { setLoading(false); }
  }, [season, enabled]);
  useEffect(() => { void load(); }, [load]);
  return { snap, clock, error, loading, refresh: load };
}

export function useSeasonCalendar() {
  const [snap, setSnap] = useState<SeasonCalendarSnapshot | null>(null);
  const [clock, setClock] = useState<ServerClock | null>(null);
  const load = useCallback(async () => {
    try { const r = await fetchSeasonCalendar(); setSnap(r.data); setClock(r.clock); } catch { setSnap(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { snap, clock, refresh: load };
}

/**
 * Cuenta atrás hacia `targetMs` (instante del servidor). Repinta cada 30 s, o cada segundo en las
 * últimas 24 h. Al cruzar 0 llama a `onZero` UNA vez: la pantalla pide otra foto y el servidor decide.
 */
export function useCountdown(targetMs: number | null, clock: ServerClock | null, onZero?: () => void): Countdown | null {
  const [, setTick] = useState(0);
  const prev = useRef<number | null>(null);
  const fired = useRef(false);
  const now = clock ? estimateServerNow(clock, Date.now()) : null;
  const c = targetMs !== null && now !== null ? countdown(targetMs, now) : null;

  useEffect(() => { fired.current = false; prev.current = null; }, [targetMs, clock?.serverNow]);
  useEffect(() => {
    if (!c) return;
    if (prev.current !== null && crossedZero(prev.current, c.totalMs) && !fired.current) { fired.current = true; onZero?.(); }
    prev.current = c.totalMs;
    if (c.expired) return;
    const id = window.setTimeout(() => setTick((t) => t + 1), tickMs(c));
    return () => window.clearTimeout(id);
  });
  return c;
}
