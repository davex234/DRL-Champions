"use client";

/**
 * ROAD TO CHAMPIONS — CLIENTE (Fase 35).
 *
 * Todo pasa por `/api/game/campaign`. Aquí no se decide nada: ni si un nodo está desbloqueado, ni quién ganó,
 * ni qué se paga. Sin conexión no se finge progreso: la pantalla dice «SIN CONEXIÓN · Tu progreso está seguro»
 * y espera a volver a leer el servidor. Nada se guarda en el navegador.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { CampaignSnapshot } from "@/domain/campaign/snapshot";
import type { DuelMatchView } from "@/lib/duel/types";

export type { CampaignSnapshot };

export class CampaignError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null, readonly payload: Record<string, unknown> | null = null) {
    super(message);
    this.name = "CampaignError";
  }
}

const URL_ = "/api/game/campaign";

async function token(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

async function parse<T>(res: Response, fallback: string): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new CampaignError(json.error ?? fallback, res.status, json.code ?? null, json as Record<string, unknown>);
  return json as T;
}

export async function fetchCampaign(): Promise<CampaignSnapshot> {
  const t = await token();
  const res = await fetch(URL_, { headers: t ? { authorization: `Bearer ${t}` } : {}, cache: "no-store" });
  return parse<CampaignSnapshot>(res, "No se pudo leer Road to Champions");
}

async function post<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const t = await token();
  if (!t) throw new CampaignError("Inicia sesión para jugar Road to Champions", 401, "UNAUTHENTICATED");
  const res = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
  return parse<T>(res, fallback);
}

/** Solo nodo y, si se elige, qué equipo TUYO. Nunca dificultad, rival ni recompensa. */
export const startCampaignNode = (nodeId: string, deckId?: string | null) =>
  post<{ view: DuelMatchView; nodeId: string; replay: boolean }>({ action: "start", nodeId, ...(deckId ? { deckId } : {}) }, "No se pudo lanzar el nodo");

export const syncCampaign = () => post<CampaignSnapshot>({ action: "sync" }, "No se pudo sincronizar la campaña");

export const abandonCampaignNode = () => post<CampaignSnapshot>({ action: "abandon" }, "No se pudo abandonar el nodo");

export type CampaignLoad =
  | { state: "loading" }
  | { state: "ready"; snapshot: CampaignSnapshot }
  | { state: "offline"; snapshot: CampaignSnapshot | null }
  | { state: "error"; message: string; snapshot: CampaignSnapshot | null };

/**
 * Lee el mapa (y sincroniza si hay sesión, para cerrar una partida terminada en otra pestaña). Vuelve a leer al
 * recuperar la conexión y al volver a la pestaña; nunca sondea.
 */
export function useCampaign(opts: { sync?: boolean } = {}): { load: CampaignLoad; reload: () => Promise<void>; setSnapshot: (s: CampaignSnapshot) => void } {
  const [load, setLoad] = useState<CampaignLoad>({ state: "loading" });
  const last = useRef<CampaignSnapshot | null>(null);
  const alive = useRef(true);
  const wantSync = opts.sync ?? false;

  const reload = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setLoad({ state: "offline", snapshot: last.current }); return; }
    try {
      const t = await token();
      const snap = t && wantSync ? await syncCampaign().catch(() => fetchCampaign()) : await fetchCampaign();
      last.current = snap;
      if (alive.current) setLoad({ state: "ready", snapshot: snap });
    } catch (e) {
      if (!alive.current) return;
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      setLoad(offline ? { state: "offline", snapshot: last.current } : { state: "error", message: e instanceof Error ? e.message : "No se pudo leer Road to Champions", snapshot: last.current });
    }
  }, [wantSync]);

  useEffect(() => {
    alive.current = true;
    void reload();
    const online = () => void reload();
    const offline = () => setLoad({ state: "offline", snapshot: last.current });
    const visible = () => { if (document.visibilityState === "visible") void reload(); };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive.current = false;
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [reload]);

  const setSnapshot = useCallback((s: CampaignSnapshot) => { last.current = s; setLoad({ state: "ready", snapshot: s }); }, []);
  return { load, reload, setSnapshot };
}
