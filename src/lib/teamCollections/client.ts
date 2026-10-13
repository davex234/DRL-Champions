"use client";

/**
 * COLECCIONES POR EQUIPO — CLIENTE. Transporte hacia `/api/game/team-collections`; aquí no se decide nada: el progreso,
 * lo que falta y las insignias regionales los calcula el servidor contra tu inventario real.
 */
import { getSupabase } from "@/lib/supabase/client";
import type { TeamCollectionsView, TeamDetailView } from "@/domain/teamCollections/model";
import { ns } from "@/i18n/runtime";

const tr = ns("trophies");

export type { TeamCollectionsView, TeamDetailView };

export class TeamCollectionsError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = "TeamCollectionsError"; }
}

async function get<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {};
  const token = (await getSupabase()?.auth.getSession())?.data.session?.access_token;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new TeamCollectionsError(json.error ?? `Error ${res.status}`, res.status, json.code);
  return json;
}

export const fetchTeamCollections = (): Promise<TeamCollectionsView> => get("/api/game/team-collections");
export const fetchTeamCollection = (teamId: string): Promise<TeamDetailView> => get(`/api/game/team-collections?team=${encodeURIComponent(teamId)}`);

export function teamCollectionsErrorText(e: unknown): string {
  if (e instanceof TeamCollectionsError) {
    if (e.status === 429) return tr("Demasiadas peticiones: espera unos segundos.");
    if (e.status === 503) return tr("Las colecciones no están disponibles ahora mismo.");
    if (e.status === 401) return tr("Tu sesión ha caducado: vuelve a entrar.");
    if (e.status === 404) return tr("Ese equipo no tiene colección.");
  }
  return tr("No se pudieron cargar tus colecciones.");
}
