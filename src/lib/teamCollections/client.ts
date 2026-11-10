"use client";

/**
 * COLECCIONES POR EQUIPO — CLIENTE. Transporte hacia `/api/game/team-collections`; aquí no se decide nada: el progreso,
 * lo que falta y las insignias regionales los calcula el servidor contra tu inventario real.
 */
import { getSupabase } from "@/lib/supabase/client";
import type { TeamCollectionsView, TeamDetailView } from "@/domain/teamCollections/model";
import type { SettleView } from "@/server/services/teamCollections";
import { ns } from "@/i18n/runtime";

const tr = ns("trophies");

export type { TeamCollectionsView, TeamDetailView, SettleView };

export class TeamCollectionsError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = "TeamCollectionsError"; }
}

async function call<T>(url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = body === undefined ? {} : { "content-type": "application/json" };
  const token = (await getSupabase()?.auth.getSession())?.data.session?.access_token;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, body === undefined ? { headers, cache: "no-store" } : { method: "POST", headers, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new TeamCollectionsError(json.error ?? `Error ${res.status}`, res.status, json.code);
  return json;
}

export const fetchTeamCollections = (): Promise<TeamCollectionsView> => call("/api/game/team-collections");
export const fetchTeamCollection = (teamId: string): Promise<TeamDetailView> => call(`/api/game/team-collections?team=${encodeURIComponent(teamId)}`);
/**
 * Pide al servidor que guarde lo que ya cumples (primeras compleciones, sus XP e insignias regionales). No lleva datos:
 * qué cumples lo decide el servidor. Repetirlo es inofensivo.
 */
export const settleTeamCollections = (): Promise<SettleView> => call("/api/game/team-collections", { action: "settle" });

export function teamCollectionsErrorText(e: unknown): string {
  if (e instanceof TeamCollectionsError) {
    if (e.status === 429) return tr("Demasiadas peticiones: espera unos segundos.");
    if (e.status === 503) return tr("Las colecciones no están disponibles ahora mismo.");
    if (e.status === 401) return tr("Tu sesión ha caducado: vuelve a entrar.");
    if (e.status === 404) return tr("Ese equipo no tiene colección.");
  }
  return tr("No se pudieron cargar tus colecciones.");
}
