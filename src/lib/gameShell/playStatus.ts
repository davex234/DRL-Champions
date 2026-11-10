"use client";

/**
 * FASE 44 · CLIENTE DEL ESTADO DE JUEGO DEL ARMAZÓN.
 *
 * `GET /api/game/play-status` (Bearer si hay sesión). Una foto compartida por todo el armazón (escritorio y móvil),
 * refrescada al cambiar de pantalla como mucho cada `MIN_GAP_MS`, al volver a la pestaña y cuando una pantalla avisa
 * de que la partida cambió (`nexus:daily-loop-changed`). Si falla, se queda en JUGAR: nunca se inventa una partida.
 */
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { PlayStatusView } from "@/design/gameShell";

export const PLAY_STATUS_TIMEOUT_MS = 6_000;
export const MIN_GAP_MS = 20_000;

let cache: { status: PlayStatusView | null; at: number; key: string | null } = { status: null, at: 0, key: null };
const listeners = new Set<(s: PlayStatusView | null) => void>();
let inflight: Promise<void> | null = null;

async function load(key: string | null): Promise<void> {
  if (!key) { cache = { status: null, at: Date.now(), key }; listeners.forEach((l) => l(null)); return; }
  const sb = getSupabase();
  const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
  if (!token) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PLAY_STATUS_TIMEOUT_MS);
  try {
    const res = await fetch("/api/game/play-status", { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return;
    const json = (await res.json()) as PlayStatusView;
    cache = { status: json, at: Date.now(), key };
    listeners.forEach((l) => l(json));
  } catch {
    /* Sin red o sin respuesta: se conserva lo que había (o JUGAR). */
  } finally {
    clearTimeout(timer);
  }
}

export function refreshPlayStatus(key: string | null, force = false): void {
  if (inflight) return;
  if (!force && cache.key === key && Date.now() - cache.at < MIN_GAP_MS) return;
  inflight = load(key).finally(() => { inflight = null; });
}

/** Estado del botón global. `userKey` = id del usuario con sesión (o `null`); `routeKey` = ruta actual. */
export function usePlayStatus(userKey: string | null, routeKey: string): PlayStatusView | null {
  const [status, setStatus] = useState<PlayStatusView | null>(cache.key === userKey ? cache.status : null);

  useEffect(() => {
    const l = (s: PlayStatusView | null) => setStatus(s);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  useEffect(() => {
    if (cache.key !== userKey) setStatus(null);
    refreshPlayStatus(userKey);
  }, [userKey, routeKey]);

  useEffect(() => {
    const onVisible = () => { if (!document.hidden) refreshPlayStatus(userKey); };
    const onChanged = () => refreshPlayStatus(userKey, true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("nexus:daily-loop-changed", onChanged);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("nexus:daily-loop-changed", onChanged);
    };
  }, [userKey]);

  return status;
}
