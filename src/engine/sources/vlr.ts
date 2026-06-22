import type { DataSource } from "../types";

/**
 * Conector VLR.gg — ESQUELETO. Implementa la misma interfaz `DataSource` que el
 * mock. La obtención real (API no oficial / scraping) se configura con
 * `NEXT_PUBLIC_VLR_API` (un proxy/endpoint que devuelva JSON). Si no está
 * configurado, lanza, y el engine cae a la fuente mock.
 *
 * REGLA: nunca se devuelven datos crudos al juego; siempre pasan por la capa de
 * normalización (`engine/sources/normalize.ts`).
 */
const BASE = process.env.NEXT_PUBLIC_VLR_API;

async function get<T>(path: string): Promise<T> {
  if (!BASE) throw new Error("VLR no configurado (NEXT_PUBLIC_VLR_API)");
  const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`VLR ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const vlrSource: DataSource = {
  id: "vlr",
  label: "VLR.gg",
  // Mapear las respuestas reales a Raw* aquí cuando se implemente el endpoint.
  getTournaments: () => get("/events"),
  getTeams: (t) => get(`/events/${t}/teams`),
  getMatches: (t) => get(`/events/${t}/matches`),
  getResult: (t) => get(`/events/${t}/result`),
};

export function isVlrConfigured(): boolean {
  return Boolean(BASE);
}
