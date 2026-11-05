"use client";

/**
 * F86 · TORNEOS — CLIENTE. Transporte hacia `/api/game/cups`; aquí no se decide nada.
 *
 * Lee con el token si hay sesión (para «mi» estado) y sin él si no la hay (el cuadro es público). Escribe SOLO un slug,
 * un cruce (ronda + posición) y un equipo: nunca un ganador, un seed o un avance. El estado ligero (indicador, aviso
 * global, espera del rival) es UN sondeo compartido por pestaña con ritmo adaptativo (F86.1).
 */
import { getSupabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth";
import { createSharedPoll, useSharedPoll } from "@/lib/net/sharedPoll";
import type { CupHub, CupDetail, CupReadyResult, CupCard, CupMatchView, CupRoundView, CupPlayer, CupMe, CupMyMatch, CupHistory, CupReadyNotice, CupLiveStatus, CupStatusMatch } from "@/server/services/cups";
import { cupPollInterval } from "./poll";

export type { CupHub, CupDetail, CupReadyResult, CupCard, CupMatchView, CupRoundView, CupPlayer, CupMe, CupMyMatch, CupHistory, CupReadyNotice, CupLiveStatus, CupStatusMatch };

export class CupError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "CupError";
  }
}

/** Evento de ventana tras una acción propia (inscribirse, retirarse, jugar): las pantallas abiertas releen. */
export const CUPS_CHANGED = "nexus:cups-changed";
export const announceCupsChange = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(CUPS_CHANGED)); };

async function token(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

async function get<T>(query: string): Promise<T> {
  const t = await token();
  const res = await fetch(`/api/game/cups${query}`, { headers: t ? { authorization: `Bearer ${t}` } : {}, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new CupError(json.error ?? `Error ${res.status}`, res.status, json.code);
  return json;
}

async function post<T>(body: { action: "register" | "withdraw" | "ready"; slug: string; round?: number; slot?: number; deckId?: string }): Promise<T> {
  const t = await token();
  if (!t) throw new CupError("Inicia sesión para participar en torneos", 401);
  const res = await fetch("/api/game/cups", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new CupError(json.error ?? `Error ${res.status}`, res.status, json.code);
  return json;
}

export const fetchCupHub = (archive = 0) => get<CupHub>(archive > 0 ? `?archive=${Math.floor(archive)}` : "");
export const fetchCup = (slug: string) => get<CupDetail>(`?slug=${encodeURIComponent(slug)}`);
export const registerCup = (slug: string) => post<{ code: string; participants: number }>({ action: "register", slug });
export const withdrawCup = (slug: string) => post<{ code: string; participants: number }>({ action: "withdraw", slug });
export const readyCup = (slug: string, round: number, slot: number, deckId: string) => post<CupReadyResult>({ action: "ready", slug, round, slot, deckId });

/**
 * F86.1 · ESTADO de mis torneos: UN sondeo compartido por toda la pestaña (indicador del menú, aviso global, espera del
 * rival y ficha), con ritmo ADAPTATIVO según mi cruce (`lib/cups/poll.ts`): 3 s esperando al rival, 5 s con cruce
 * relevante, 20 s sin nada inmediato, 60 s fuera de torneos. Pestaña oculta: no lee; al volver, al recuperar el foco o la
 * conexión, y tras cualquier acción propia (`nexus:cups-changed`): lectura inmediata. Un fallo conserva el último valor y
 * retrocede. El valor va atado a la cuenta (cambiar de sesión lo reinicia).
 */
export const NO_STATUS: CupLiveStatus = { ready: 0, tier: "cold", match: null, serverNow: 0 };
export const cupStatusPoll = createSharedPoll<CupLiveStatus>({
  fetch: () => get<CupLiveStatus>("?status=1"),
  initial: NO_STATUS, intervalMs: 60_000, minGapMs: 750, events: [CUPS_CHANGED],
  intervalFor: (v, failures) => cupPollInterval(v.tier, failures),
});

export function useCupStatus(enabled: boolean): CupLiveStatus {
  const { user } = useAuth();
  return useSharedPoll(cupStatusPoll, enabled && user ? user.id : null, NO_STATUS);
}

/** Indicador del menú «Torneos»: mis cruces que piden acción ahora (del mismo sondeo de estado). */
export function useCupBadge(enabled: boolean): number {
  return useCupStatus(enabled).ready;
}
