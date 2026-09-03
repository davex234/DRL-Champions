"use client";

/**
 * PROGRESIÓN — CAPA DE DATOS DEL CLIENTE (Fase 9E).
 *
 * Todo pasa por `/api/game/progression`, que es donde vive la autoridad. Aquí no se
 * calcula ni un nivel, ni un progreso de misión, ni si un logro está completo: el
 * servidor devuelve la vista ya resuelta y esto solo la transporta.
 *
 * Mismo patrón de autorización que el resto: el token de Supabase en la cabecera, jamás
 * el identificador de usuario en el cuerpo.
 */
import { getSupabase } from "@/lib/supabase/client";
import type { PassTrack } from "@/battlepass";
import type { ProgressionView } from "@/server/services/progression";

export type { ProgressionView, PassTrack };

/** Error con el mensaje que el servidor ya redactó para el jugador. */
export class ProgressionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ProgressionError";
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) throw new ProgressionError("La progresión necesita una cuenta online", 401);
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ProgressionError("Inicia sesión para ver tu progreso", 401);
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/game/progression", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ProgressionError(json.error ?? `Error ${res.status}`, res.status);
  return json as T;
}

export const fetchProgression = () => post<ProgressionView>({ action: "state" });

export const claimPassLevel = (level: number, track: PassTrack) =>
  post<{ rewards: unknown[] }>({ action: "claimLevel", level, track });

export const claimMission = (missionId: string) =>
  post<{ rewards: unknown[] }>({ action: "claimMission", missionId });

export const claimAchievement = (achievementId: string) =>
  post<{ credits: number }>({ action: "claimAchievement", achievementId });

/** Abre el carril de pago con FICHAS. No hay compra con dinero real (§12). */
export const unlockPremiumWithTokens = () => post<{ premium: true }>({ action: "unlockPremium" });

/**
 * Equipa (o retira, con `null`) un cosmético. La propiedad la comprueba el servidor.
 */
export const equipCosmetic = (family: string, cosmeticId: string | null) =>
  post<{ equipped: Record<string, string> }>({ action: "equipCosmetic", family, cosmeticId });

export const refreshMissions = () => post<{ missions: unknown[] }>({ action: "refreshMissions" });
