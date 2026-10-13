"use client";

/**
 * DRAFT GAUNTLET — CLIENTE (Fase 39).
 *
 * Todo pasa por `/api/game/draft-gauntlet`. Aquí no se decide nada: ni las opciones, ni si una elección es legal, ni
 * quién ganó. Cada mutación lleva un `actionId` nuevo (idempotencia) y la `version` de la última foto (concurrencia
 * optimista). Un 409 trae la foto fresca: se pinta y se avisa. Sin conexión se enseña la última foto recibida con
 * las acciones desactivadas; nada se guarda en el navegador.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { DraftSnapshot } from "@/domain/draft/snapshot";
import { ns } from "@/i18n/runtime";

const tr = ns("draft");

export type { DraftSnapshot };

export class DraftError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null, readonly snapshot: DraftSnapshot | null = null) {
    super(message);
    this.name = "DraftError";
  }
}

export const DRAFT_API = "/api/game/draft-gauntlet";

async function token(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

async function parse<T>(res: Response, fallback: string): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string; snapshot?: DraftSnapshot };
  if (!res.ok) throw new DraftError(json.error ?? fallback, res.status, json.code ?? null, json.snapshot ?? null);
  return json as T;
}

export function newActionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

export async function fetchDraft(): Promise<DraftSnapshot> {
  const t = await token();
  const res = await fetch(DRAFT_API, { headers: t ? { authorization: `Bearer ${t}` } : {}, cache: "no-store" });
  return parse<DraftSnapshot>(res, "No se pudo leer Draft Gauntlet");
}

async function post<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const t = await token();
  if (!t) throw new DraftError("Inicia sesión para jugar Draft Gauntlet", 401, "UNAUTHENTICATED");
  const res = await fetch(DRAFT_API, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
  return parse<T>(res, fallback);
}

/** Solo `actionId`. Nunca semilla ni cartas. */
export const startDraft = (actionId = newActionId()) => post<DraftSnapshot>({ action: "start", actionId }, tr("No se pudo empezar la run"));

/** Solo el id público de la carta elegida, la versión vista y el `actionId`. */
export const pickDraft = (choiceId: string, expectedVersion: number, actionId = newActionId()) =>
  post<DraftSnapshot>({ action: "pick", actionId, expectedVersion, choiceId }, tr("No se pudo confirmar la elección"));

export const startDraftMatch = (expectedVersion: number, actionId = newActionId()) =>
  post<{ snapshot: DraftSnapshot; matchId: string }>({ action: "start_match", actionId, expectedVersion }, tr("No se pudo empezar el combate"));

export const abandonDraft = (expectedVersion: number, actionId = newActionId()) =>
  post<DraftSnapshot>({ action: "abandon", actionId, expectedVersion, confirm: true }, tr("No se pudo abandonar la run"));

export type DraftLoad =
  | { state: "loading" }
  | { state: "ready"; snapshot: DraftSnapshot }
  | { state: "offline"; snapshot: DraftSnapshot | null }
  | { state: "error"; message: string; snapshot: DraftSnapshot | null };

/** Lee la run al entrar, al recuperar la conexión y al volver a la pestaña. Nunca sondea. */
export function useDraft(): { load: DraftLoad; reload: () => Promise<void>; setSnapshot: (s: DraftSnapshot) => void } {
  const [load, setLoad] = useState<DraftLoad>({ state: "loading" });
  const last = useRef<DraftSnapshot | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setLoad({ state: "offline", snapshot: last.current }); return; }
    try {
      const snap = await fetchDraft();
      last.current = snap;
      if (alive.current) setLoad({ state: "ready", snapshot: snap });
    } catch (e) {
      if (!alive.current) return;
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      setLoad(offline ? { state: "offline", snapshot: last.current } : { state: "error", message: e instanceof Error ? e.message : tr("No se pudo leer Draft Gauntlet"), snapshot: last.current });
    }
  }, []);

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

  const setSnapshot = useCallback((s: DraftSnapshot) => { last.current = s; setLoad({ state: "ready", snapshot: s }); }, []);
  return { load, reload, setSnapshot };
}
