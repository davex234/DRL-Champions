"use client";

/**
 * DAILY GAME LOOP — CLIENTE (Fase 36).
 *
 *   · `fetchDailyLoop` → `GET /api/game/daily-loop` (Bearer si hay sesión; nunca un `userId` en la petición).
 *   · `useDailyLoop`   → carga, reloj de servidor, sin conexión, refresco al volver a la pestaña.
 *
 * Aquí no se decide nada: la acción principal y los bloques llegan decididos por el servidor. El cliente
 * solo pinta, cuenta hacia atrás desde `serverNow` y vuelve a pedir la foto.
 *
 * Degradación: cada petición tiene tiempo máximo (`DAILY_LOOP_TIMEOUT_MS`). Si falla o se pierde la red, se
 * CONSERVA la última foto (marcada como antigua) y las acciones que necesitan servidor se desactivan: nada
 * de datos nuevos fingidos, y nada de esperar 20 s a los reintentos de supabase-js.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { DailyLoopSnapshot } from "@/domain/dailyLoop";
import type { ServerClock } from "@/domain/season/time";

export type { DailyLoopSnapshot };

export const DAILY_LOOP_TIMEOUT_MS = 8_000;
/** Mínimo entre refrescos automáticos (volver a la pestaña). El botón «Actualizar» no espera. */
export const REFRESH_MIN_GAP_MS = 30_000;
/** Fase 42 · refresco periódico con la pestaña visible (nunca polling de 1 s). */
export const REFRESH_INTERVAL_MS = 60_000;
/** Fase 42 · margen tras un reset/cierre real antes de volver a pedir la foto (el servidor ya decide la ventana). */
export const BOUNDARY_GRACE_MS = 2_000;

/** Próximo instante en que la foto cambia sola (reset diario/semanal, cierre de Pick'em), en reloj del servidor. */
export function nextBoundary(snap: DailyLoopSnapshot | null): number | null {
  const s = snap?.service;
  if (!s) return null;
  const c = [s.resets.dailyEndsAt, s.resets.weeklyEndsAt, ...s.expiring.map((e) => e.endsAt)].filter((x) => x > snap!.serverNow);
  return c.length ? Math.min(...c) : null;
}
/** Eventos del producto que invalidan la foto (los emiten las pantallas que ya los emitían). */
export const INVALIDATION_EVENTS = ["nexus:social-changed", "nexus:daily-loop-changed"] as const;

export type DailyLoopStatus = "loading" | "ready" | "error" | "offline";

export class DailyLoopError extends Error {
  constructor(message: string, public status: number, public code: string | null) { super(message); }
}

async function authHeader(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) return {};
  const token = (await sb.auth.getSession()).data.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function fetchDailyLoop(timeoutMs = DAILY_LOOP_TIMEOUT_MS): Promise<{ data: DailyLoopSnapshot; clock: ServerClock }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("/api/game/daily-loop", { headers: await authHeader(), cache: "no-store", signal: ctrl.signal });
    const receivedAt = Date.now();
    const json = (await res.json().catch(() => ({}))) as DailyLoopSnapshot & { error?: string; code?: string };
    if (!res.ok) throw new DailyLoopError(json.error ?? "No se pudo leer tu sesión de juego", res.status, json.code ?? null);
    return { data: json, clock: { serverNow: typeof json.serverNow === "number" ? json.serverNow : receivedAt, receivedAt } };
  } catch (e) {
    if (e instanceof DailyLoopError) throw e;
    throw new DailyLoopError(ctrl.signal.aborted ? "El servidor tarda demasiado" : "Sin conexión con el servidor", 0, ctrl.signal.aborted ? "TIMEOUT" : "NETWORK");
  } finally {
    clearTimeout(timer);
  }
}

export interface DailyLoopState {
  snap: DailyLoopSnapshot | null;
  clock: ServerClock | null;
  status: DailyLoopStatus;
  /** La foto en pantalla es de una lectura anterior (error o sin conexión). */
  stale: boolean;
  refresh: () => void;
}

/**
 * `userKey` cambia al iniciar o cerrar sesión: la foto se vuelve a pedir y la anterior se descarta (no se
 * enseña la foto de otra cuenta ni un instante).
 */
export function useDailyLoop({ enabled, userKey }: { enabled: boolean; userKey: string | null }): DailyLoopState {
  const [snap, setSnap] = useState<DailyLoopSnapshot | null>(null);
  const [clock, setClock] = useState<ServerClock | null>(null);
  const [status, setStatus] = useState<DailyLoopStatus>("loading");
  const [stale, setStale] = useState(false);
  const last = useRef(0);
  const inflight = useRef(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!enabled || inflight.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setStatus("offline"); setStale(true); return; }
    inflight.current = true;
    last.current = Date.now();
    try {
      const r = await fetchDailyLoop();
      if (!alive.current) return;
      setSnap(r.data); setClock(r.clock); setStatus("ready"); setStale(false);
    } catch (e) {
      if (!alive.current) return;
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      setStatus(offline || (e instanceof DailyLoopError && e.code === "NETWORK") ? "offline" : "error");
      setStale(true);
    } finally {
      inflight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    alive.current = true;
    setSnap(null); setClock(null); setStale(false); setStatus("loading");
    void load();
    return () => { alive.current = false; };
  }, [load, userKey]);

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() - last.current >= REFRESH_MIN_GAP_MS) void load(); };
    const onOnline = () => void load();
    const onOffline = () => { setStatus("offline"); setStale(true); };
    const onInvalidate = () => void load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    for (const ev of INVALIDATION_EVENTS) window.addEventListener(ev, onInvalidate);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      for (const ev of INVALIDATION_EVENTS) window.removeEventListener(ev, onInvalidate);
    };
  }, [enabled, load]);

  // Fase 42 · con la pestaña visible: refresco cada 60 s y justo después del siguiente reset/cierre real (reloj del
  // servidor + desfase medido). El cliente no decide la rotación: vuelve a preguntar al servidor.
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled, load]);
  useEffect(() => {
    if (!enabled || !snap || !clock) return;
    const b = nextBoundary(snap);
    if (b === null) return;
    const offset = clock.serverNow - clock.receivedAt;
    const wait = Math.max(0, b - (Date.now() + offset)) + BOUNDARY_GRACE_MS;
    if (wait > 24 * 3600_000) return;
    const id = window.setTimeout(() => void load(), wait);
    return () => window.clearTimeout(id);
  }, [enabled, snap, clock, load]);

  return { snap, clock, status: enabled ? status : "ready", stale, refresh: () => void load() };
}
