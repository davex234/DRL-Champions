"use client";

/**
 * F73 · CLIENTE DE CRAFTEO Y MISIONES. El navegador solo PIDE: receta + (cartas) uids + gesto de idempotencia. Todo lo
 * demás —inventario, saldo, qué carta sale, progreso— lo decide y lo devuelve el servidor.
 */
import { getSupabase } from "@/lib/supabase/client";
import type { CraftingSnapshot, PackCraftResult, CardCraftResult } from "@/server/services/crafting";
import type { MissionsSnapshot } from "@/server/services/missionEngine";
import type { ForgeCraftResult, ForgeSnapshot } from "@/server/services/forge";

export type { CraftingSnapshot, PackCraftResult, CardCraftResult, MissionsSnapshot, ForgeSnapshot, ForgeCraftResult };

export class CraftError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null) { super(message); this.name = "CraftError"; }
}

async function headers(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) throw new CraftError("Necesitas una cuenta online", 401);
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new CraftError("Inicia sesión", 401);
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

async function call<T>(url: string, init?: { body?: unknown }): Promise<T> {
  const res = await fetch(url, init?.body !== undefined ? { method: "POST", headers: await headers(), body: JSON.stringify(init.body) } : { headers: await headers(), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new CraftError(json.error ?? `Error ${res.status}`, res.status, json.code ?? null);
  return json as T;
}

/** Una clave por INTENCIÓN (el mismo diálogo reintentado reusa la clave: idempotencia). */
export function newGesture(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const fetchCrafting = () => call<CraftingSnapshot>("/api/game/crafting");
/** `expectedQty` = los sobres que el jugador VIO en la receta: si cambió en el servidor, 409 sin descontar nada. */
export const craftPackReq = (recipeId: string, ref: string, expectedQty?: number) => call<PackCraftResult>("/api/game/crafting", { body: { action: "craftPack", recipeId, ref, ...(expectedQty !== undefined ? { expectedQty } : {}) } });
export const craftCardReq = (recipeId: string, uids: string[], ref: string) => call<CardCraftResult>("/api/game/crafting", { body: { action: "craftCard", recipeId, uids, ref } });
export const fetchMissions = () => call<MissionsSnapshot>("/api/game/missions");
export const claimMissionReq = (missionId: string) => call<{ repeated: boolean; snapshot: MissionsSnapshot }>("/api/game/missions", { body: { action: "claimMission", missionId } });
export const claimProjectReq = (projectId: string) => call<{ repeated: boolean; cardId: string; cardUid: string | null; snapshot: MissionsSnapshot }>("/api/game/missions", { body: { action: "claimProject", projectId } });

/* F79 · NEXUS FORGE 2.0 — el navegador PIDE; nivel, XP, desbloqueos y salida los decide el servidor. */
export const fetchForge = () => call<ForgeSnapshot>("/api/game/forge");
export const forgeCraftReq = (recipeId: string, uids: string[], ref: string, confirmProtected: string[] = []) =>
  call<ForgeCraftResult>("/api/game/forge", { body: { action: "craft", recipeId, uids, ref, ...(confirmProtected.length ? { confirmProtected } : {}) } });
export const claimObjectiveReq = (objectiveId: string) => call<{ repeated: boolean; snapshot: ForgeSnapshot }>("/api/game/forge", { body: { action: "claimObjective", objectiveId } });
/** Analítica `recipe_view` (el servidor solo la registra). Nunca bloquea ni rompe nada. */
export const trackRecipeView = (recipeId: string) => { void call<{ ok: boolean }>("/api/game/forge", { body: { action: "view", recipeId } }).catch(() => undefined); };
export const claimAchievementReq = (achievementId: string) => call<{ repeated: boolean; snapshot: ForgeSnapshot }>("/api/game/forge", { body: { action: "claimAchievement", achievementId } });
