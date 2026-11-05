"use client";

/**
 * LIVE EVENTS — CLIENTE (Fase 30). Transporte hacia `/api/game/live-events`; aquí no se decide
 * nada. Con sesión viaja el Bearer (datos personales: predicciones, propiedad, objetivos); sin
 * sesión se leen los datos públicos del evento. El refresco en directo reutiliza la política de
 * Pick'ems (`refreshIntervalFor`: 20 s con partido en directo · 45 s en curso · 2 min futuro ·
 * 5 min terminado; nada con la pestaña oculta o sin red) y UN solo `setTimeout` por pantalla.
 */
import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth";
import { createSharedPoll, useSharedPoll } from "@/lib/net/sharedPoll";
import { refreshIntervalFor } from "@/domain/pickems/live";
import type { EventsOverviewSnapshot, EventHubSnapshot, EventMatchSnapshot } from "@/server/services/liveEvents";

export type { EventsOverviewSnapshot, EventHubSnapshot, EventMatchSnapshot };

export class LiveEventsError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "LiveEventsError"; }
}

async function headers(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) return {};
  const { data } = await sb.auth.getSession();
  const t = data.session?.access_token;
  return t ? { authorization: `Bearer ${t}` } : {};
}

async function get<T>(query: string): Promise<T> {
  const res = await fetch(`/api/game/live-events${query}`, { headers: await headers(), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new LiveEventsError(json.error ?? `Error ${res.status}`, res.status);
  return json;
}

export const fetchEventsOverview = () => get<EventsOverviewSnapshot>("");
export const fetchEventHub = (eventId: string) => get<EventHubSnapshot>(`?event=${encodeURIComponent(eventId)}`);
export const fetchEventMatch = (matchId: string) => get<EventMatchSnapshot>(`?match=${encodeURIComponent(matchId)}`);
export const fetchLiveCount = () => get<{ live: number }>("?badge=1");

/**
 * Refresco en directo con la política existente. `status` es el ciclo de vida del evento
 * traducido al vocabulario de Pick'ems; `hasLive` acelera a 20 s. Un solo temporizador, que
 * se reprograma tras cada lectura y se para con la pestaña oculta o sin red.
 */
export function useLiveRefresh(input: { enabled: boolean; status: "upcoming" | "live" | "finished"; hasLive: boolean; reload: () => Promise<void> }): { failures: number; lastUpdatedAt: number | null; online: boolean } {
  const [failures, setFailures] = useState(0);
  const [lastUpdatedAt, setLast] = useState<number | null>(null);
  const [online, setOnline] = useState(true);
  const [visibility, setVisibility] = useState<"visible" | "hidden">("visible");
  const reloadRef = useRef(input.reload);
  reloadRef.current = input.reload;

  useEffect(() => {
    const onVis = () => setVisibility(document.visibilityState === "hidden" ? "hidden" : "visible");
    const onOn = () => setOnline(true); const onOff = () => setOnline(false);
    onVis(); setOnline(navigator.onLine);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOn); window.addEventListener("offline", onOff);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("online", onOn); window.removeEventListener("offline", onOff); };
  }, []);

  useEffect(() => {
    if (!input.enabled) return;
    const delay = refreshIntervalFor({ online, visibility, failures, hasLive: input.hasLive, status: input.status });
    if (delay === null) return;
    let alive = true;
    const id = window.setTimeout(() => {
      reloadRef.current().then(() => { if (alive) { setFailures(0); setLast(Date.now()); } }).catch(() => { if (alive) setFailures((f) => f + 1); });
    }, delay);
    return () => { alive = false; window.clearTimeout(id); };
  }, [input.enabled, input.status, input.hasLive, online, visibility, failures, lastUpdatedAt]);

  return { failures, lastUpdatedAt, online };
}

/** Número de partidos en directo para la navegación: al montar, al volver y cada 2 min. */
/** F64 · UN sondeo compartido (antes, uno por cada sitio del armazón que pintaba la insignia). */
const liveBadgePoll = createSharedPoll<number>({ fetch: () => fetchLiveCount().then((b) => b.live), initial: 0, intervalMs: 120_000 });

export function useLiveBadge(enabled: boolean): number {
  const { user } = useAuth();
  return useSharedPoll(liveBadgePoll, enabled && user ? user.id : null, 0);
}
