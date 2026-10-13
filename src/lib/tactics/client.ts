"use client";

/**
 * ESTRATEGIAS — CAPA DE DATOS DEL CLIENTE (Fase 9I).
 *
 * Todo pasa por `/api/game/strats`. Aquí no se valida ni se sanea nada: el editor usa las
 * funciones del dominio para trabajar cómodo, pero la palabra autorizada sobre lo que se
 * guarda es siempre la del servidor, que vuelve a sanear con `sanitizeStrat`.
 */
import { getSupabase } from "@/lib/supabase/client";
import type { Side, Strat } from "@/domain/tactics";
import type { Composition } from "@/domain/tactics/composition";

export interface StratRow {
  id: string;
  name: string;
  mapId: string;
  side: Side;
  updatedAt: string;
  plan: Strat;
  /** Cuántos pasos tiene, ya contados por el servidor: la lista no necesita abrir el plan. */
  steps: number;
}

export class StratError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "StratError";
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) throw new StratError("Las estrategias necesitan una cuenta online", 401);
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new StratError("Inicia sesión para guardar estrategias", 401);
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

export async function fetchStrats(): Promise<StratRow[]> {
  const res = await fetch("/api/game/strats", { headers: await authHeaders() });
  const json = (await res.json().catch(() => ({}))) as { strats?: StratRow[]; error?: string };
  if (!res.ok) throw new StratError(json.error ?? `Error ${res.status}`, res.status);
  return json.strats ?? [];
}

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/game/strats", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new StratError(json.error ?? `Error ${res.status}`, res.status);
  return json as T;
}

/** Guarda. Con `id` actualiza; sin `id`, crea. */
export const saveStrat = (strat: Strat, id: string | null) =>
  post<{ id: string }>({ action: "save", id, strat });

export const deleteStrat = (id: string) => post<{ ok: true }>({ action: "delete", id });

/** Copia una estrategia como nueva. El servidor le pone identificador propio. */
export const duplicateStrat = (id: string) => post<{ id: string }>({ action: "duplicate", id });

/* ═══════════════════════════ FASE 47 ═══════════════════════════
 *
 * Composiciones y plan táctico de una partida. Misma capa fina que arriba: arma la petición,
 * adjunta el Bearer y devuelve lo que contesta el servidor. No valida (eso es del dominio, y lo
 * aplica la API) y no decide nada.
 */

/**
 * Error con CÓDIGO. `StratError` sólo lleva estado, y hay dos respuestas que la interfaz necesita
 * distinguir de un fallo cualquiera: `VERSION_CONFLICT` (otra pestaña guardó antes) y el rechazo
 * por mapa cruzado. Tragárselos en un «error» genérico convierte un aviso útil en un susto.
 */
export class TacticsError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null, readonly extra?: Record<string, unknown>) {
    super(message);
    this.name = "TacticsError";
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: await authHeaders(), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new TacticsError(
      typeof json.error === "string" ? json.error : `Error ${res.status}`,
      res.status,
      typeof json.code === "string" ? json.code : null,
      json,
    );
  }
  return json as T;
}

/**
 * Guarda con CERROJO OPTIMISTA. `baseVersion` es la `updatedAt` que leyó el editor: si la fila ya
 * no está en esa versión, el servidor responde 409 `VERSION_CONFLICT` en vez de pisar el trabajo de
 * otra pestaña. Sin `baseVersion` se comporta como antes.
 */
export const saveStratVersioned = (strat: Strat, id: string | null, baseVersion: string | null) =>
  call<{ id: string; version: string }>("/api/game/strats", {
    method: "POST",
    body: JSON.stringify({ action: "save", id, strat, baseVersion }),
  });

/* ─── Composiciones ─── */
/**
 * FASE 51.3.1 · con Supabase inalcanzable (p. ej. el túnel caído) la ruta tarda ~38 s en fallar
 * cerrado con 401: `getSession` reintenta contra GoTrue antes de rendirse. La pantalla no se queda
 * ahí colgada — se corta y se enseña el estado de error, que se puede reintentar.
 */
export const fetchCompositions = (init?: RequestInit) =>
  call<{ compositions: Composition[] }>("/api/game/compositions", init).then((r) => r.compositions);

export const saveComposition = (composition: { id?: string; name: string; mapId: string; agentIds: string[]; notes: string }) =>
  call<{ composition: Composition }>("/api/game/compositions", {
    method: "POST", body: JSON.stringify({ action: "save", composition }),
  }).then((r) => r.composition);

export const deleteComposition = (id: string) =>
  call<{ ok: true }>("/api/game/compositions", { method: "POST", body: JSON.stringify({ action: "delete", id }) });

export const setPrimaryComposition = (id: string) =>
  call<{ composition: Composition }>("/api/game/compositions", {
    method: "POST", body: JSON.stringify({ action: "primary", id }),
  }).then((r) => r.composition);

/* ─── Plan táctico de una partida ─── */
export interface AssignedStrat {
  id: string;
  stratId: string;
  sortOrder: number;
  name: string;
  mapId: string;
  side: string;
  compositionId: string | null;
}

export const fetchMatchStrats = (matchId: string) =>
  call<{ assigned: AssignedStrat[] }>(`/api/game/match-strats?matchId=${encodeURIComponent(matchId)}`).then((r) => r.assigned);

export const assignStrat = (matchId: string, stratId: string) =>
  call<{ ok: true }>("/api/game/match-strats", {
    method: "POST", body: JSON.stringify({ action: "assign", matchId, stratId }),
  });

export const unassignStrat = (matchId: string, stratId: string) =>
  call<{ ok: true }>("/api/game/match-strats", {
    method: "POST", body: JSON.stringify({ action: "unassign", matchId, stratId }),
  });

/* ═══════════════════════════ FASE 51 · EXPEDIENTE ═══════════════════════════
 *
 * Los partidos dirigidos, tal y como los devuelve `/api/game/coach-matches`. El plan táctico pide
 * SU partido por id (el servidor lo filtra por dueño: una partida ajena o inexistente es un 404
 * idéntico), y el hub lista los recientes para que el plan tenga un camino de entrada.
 */
export interface CoachMatchSummary {
  id: string;
  teamName: string;
  rivalName: string;
  difficulty: string;
  mapId: string;
  scoreHome: number;
  scoreAway: number;
  won: boolean;
  finishedAt: string;
}

export const fetchCoachMatch = (id: string) =>
  call<{ match: CoachMatchSummary }>(`/api/game/coach-matches?id=${encodeURIComponent(id)}`).then((r) => r.match);

export const fetchCoachMatches = (limit = 12) =>
  call<{ matches: CoachMatchSummary[]; total: number }>(`/api/game/coach-matches?limit=${limit}`);
