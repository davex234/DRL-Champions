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

export interface StratRow {
  id: string;
  name: string;
  mapId: string;
  side: Side;
  updatedAt: string;
  plan: Strat;
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
