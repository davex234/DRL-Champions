"use client";

/**
 * PLAYER IDENTITY — CLIENTE (Fase 31). Transporte hacia `/api/game/player`; aquí no se decide
 * nada. Sin sesión se lee la foto pública; con sesión viaja el Bearer (el servidor decide si es
 * SELF). Las mutaciones solo envían ids: las cartas y los logros los valida el servidor.
 */
import { getSupabase } from "@/lib/supabase/client";
import type { PlayerIdentitySnapshot } from "@/domain/profile/identity";
import type { HistoryItem } from "@/domain/profile/career";

export type { PlayerIdentitySnapshot };

export class PlayerError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = "PlayerError"; }
}

async function headers(json = false): Promise<Record<string, string>> {
  const out: Record<string, string> = json ? { "content-type": "application/json" } : {};
  const sb = getSupabase();
  if (!sb) return out;
  const { data } = await sb.auth.getSession();
  const t = data.session?.access_token;
  if (t) out.authorization = `Bearer ${t}`;
  return out;
}

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new PlayerError(json.error ?? `Error ${res.status}`, res.status, json.code);
  return json;
}

export async function fetchPlayerIdentity(playerId: string): Promise<PlayerIdentitySnapshot> {
  return parse(await fetch(`/api/game/player?id=${encodeURIComponent(playerId)}`, { headers: await headers(), cache: "no-store" }));
}

/** F89 · página siguiente del historial (cursor = instante de la última fila). */
export async function fetchPlayerHistory(playerId: string, before: number): Promise<{ items: HistoryItem[]; nextBefore: number | null }> {
  return parse(await fetch(`/api/game/player?id=${encodeURIComponent(playerId)}&history=1&before=${before}`, { headers: await headers(), cache: "no-store" }));
}

export async function fetchMyIdentity(): Promise<PlayerIdentitySnapshot> {
  return parse(await fetch("/api/game/player?me=1", { headers: await headers(), cache: "no-store" }));
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  return parse(await fetch("/api/game/player", { method: "POST", headers: await headers(true), body: JSON.stringify(body) }));
}

export const saveShowcase = (cardUids: string[], expectedVersion: number | null) =>
  post<{ code: string; version: number }>({ action: "set_showcase", cardUids, expectedVersion });
export const saveFeaturedAchievements = (achievementIds: string[], expectedVersion: number | null) =>
  post<{ code: string; version: number }>({ action: "set_featured_achievements", achievementIds, expectedVersion });
export const saveAvatar = (avatar: string) => post<{ avatar: string }>({ action: "set_avatar", avatar });
/** F82 · insignias destacadas (hasta 3, solo propias). */
export const saveFeaturedBadges = (badgeIds: string[], expectedVersion: number | null) =>
  post<{ code: string; version: number }>({ action: "set_featured_badges", badgeIds, expectedVersion });

/** Copia la URL canónica. `navigator.share` si existe (móvil), si no el portapapeles. Sin servidor. */
export async function shareProfile(url: string, title: string): Promise<"shared" | "copied" | "failed"> {
  try {
    const nav = navigator as Navigator & { share?: (d: { url: string; title: string }) => Promise<void> };
    if (typeof nav.share === "function" && window.matchMedia?.("(pointer: coarse)").matches) { await nav.share({ url, title }); return "shared"; }
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch { return "failed"; }
}

/** F89 · equipo favorito (id del catálogo o `null` para quitarlo). */
export const saveFavoriteTeam = (teamId: string | null, expectedVersion: number | null) =>
  post<{ code: string; version: number }>({ action: "set_favorite_team", teamId, expectedVersion });
