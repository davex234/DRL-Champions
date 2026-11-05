"use client";

/**
 * SOCIAL — CLIENTE (Fase 29). Transporte hacia `/api/game/social`; aquí no se decide nada.
 *
 * El cliente envía SOLO ids (jugador, reto, mazo) y el token en la cabecera. Nunca bandos,
 * nunca resultados, nunca «somos amigos». Todo estado social que se pinta viene del servidor.
 * `useSocialHeartbeat` late una vez por minuto mientras la pestaña está visible: es la ÚNICA
 * fuente de presencia y solo puede tocar el `last_seen_at` propio.
 */
import { useEffect } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth";
import { createSharedPoll, useSharedPoll } from "@/lib/net/sharedPoll";
import { HEARTBEAT_MS } from "@/domain/social/social";
import type {
  SocialSnapshot, SocialSearchResult, SocialPlayerView, RelationChange, ChallengeCreated, ChallengeResponded,
  FriendView, ChallengeView, RecentOpponentView, SearchHit, PrivateMatchInfo, SocialPulse, SocialCompare,
} from "@/server/services/social";

export type {
  SocialSnapshot, SocialSearchResult, SocialPlayerView, RelationChange, ChallengeCreated, ChallengeResponded,
  FriendView, ChallengeView, RecentOpponentView, SearchHit, PrivateMatchInfo, SocialPulse, SocialCompare,
};

export class SocialError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "SocialError";
  }
}

async function token(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

async function get<T>(query: string): Promise<T | null> {
  const t = await token();
  if (!t) return null;
  const res = await fetch(`/api/game/social${query}`, { headers: { authorization: `Bearer ${t}` }, cache: "no-store" });
  if (res.status === 401) return null;
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new SocialError(json.error ?? `Error ${res.status}`, res.status, json.code);
  return json;
}

export type SocialAction =
  | "friend_request" | "friend_accept" | "friend_decline" | "unfriend" | "block" | "unblock"
  | "challenge_create" | "challenge_accept" | "challenge_decline" | "challenge_cancel" | "heartbeat" | "pulse";

async function post<T>(body: { action: SocialAction; targetUserId?: string; challengeId?: string; deckId?: string | null; previousMatchId?: string | null }): Promise<T> {
  const t = await token();
  if (!t) throw new SocialError("Inicia sesión para usar lo social", 401);
  const res = await fetch("/api/game/social", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new SocialError(json.error ?? `Error ${res.status}`, res.status, json.code);
  return json;
}

export const fetchSocial = () => get<SocialSnapshot>("");
export const fetchSocialBadge = () => get<{ badge: number; activeMatchId: string | null }>("?badge=1");
export const searchSocial = (q: string, offset = 0) => get<SocialSearchResult>(`?q=${encodeURIComponent(q)}${offset > 0 ? `&offset=${offset}` : ""}`);
export const fetchFriendsPage = (offset: number) => get<{ friends: FriendView[]; offset: number; total: number; hasMore: boolean }>(`?friends=1&offset=${Math.max(0, Math.floor(offset))}`);
export const fetchSocialCompare = (playerId: string) => get<SocialCompare>(`?compare=${encodeURIComponent(playerId)}`);
export const fetchSocialPlayer = (playerId: string) => get<SocialPlayerView>(`?player=${encodeURIComponent(playerId)}`);
export const fetchPrivateMatchInfo = (matchId: string) => get<PrivateMatchInfo>(`?match=${encodeURIComponent(matchId)}`);

export const sendFriendRequest = (targetUserId: string) => post<RelationChange>({ action: "friend_request", targetUserId });
export const acceptFriend = (targetUserId: string) => post<RelationChange>({ action: "friend_accept", targetUserId });
export const declineFriend = (targetUserId: string) => post<RelationChange>({ action: "friend_decline", targetUserId });
export const removeFriend = (targetUserId: string) => post<RelationChange>({ action: "unfriend", targetUserId });
export const blockUser = (targetUserId: string) => post<RelationChange>({ action: "block", targetUserId });
export const unblockUser = (targetUserId: string) => post<RelationChange>({ action: "unblock", targetUserId });

export const createChallenge = (targetUserId: string, deckId: string, previousMatchId: string | null = null) =>
  post<ChallengeCreated>({ action: "challenge_create", targetUserId, deckId, previousMatchId });
export const acceptChallenge = (challengeId: string, deckId: string) =>
  post<ChallengeResponded>({ action: "challenge_accept", challengeId, deckId });
export const declineChallenge = (challengeId: string) => post<ChallengeResponded>({ action: "challenge_decline", challengeId });
export const cancelChallengeReq = (challengeId: string) => post<{ code: string }>({ action: "challenge_cancel", challengeId });
export const sendHeartbeat = () => post<{ lastSeenAt: number }>({ action: "heartbeat" });
export const sendPulse = () => post<SocialPulse>({ action: "pulse" });

/**
 * F85 · PULSO SOCIAL COMPARTIDO: UNA petición (`POST pulse`) cada `HEARTBEAT_MS` (20 s) con la pestaña visible, al volver a
 * ella y tras cualquier acción social. Latido de presencia + contador de la navegación + reto recibido / enviado en curso.
 * Lo monta el armazón (toda la app), no solo `/social`: «en línea» significa «con la app abierta», no «con /social abierto».
 * Un fallo conserva el último valor (nunca inventa uno). Va atado a la cuenta: otra cuenta, otro valor.
 */
export const socialPulsePoll = createSharedPoll<SocialPulse | null>({
  fetch: () => sendPulse().catch(() => null),
  initial: null,
  intervalMs: HEARTBEAT_MS,
  events: ["nexus:social-changed"],
});

export function useSocialPulse(enabled: boolean): SocialPulse | null {
  const { user } = useAuth();
  return useSharedPoll(socialPulsePoll, enabled && user ? user.id : null, null);
}

/** El número de la navegación («Social · N»), del pulso del servidor. */
export function useSocialBadge(enabled: boolean): number {
  return useSocialPulse(enabled)?.badge ?? 0;
}

/** Compatibilidad F29: el latido ya lo da el pulso del armazón; montar esto solo fuerza una lectura. */
export function useSocialHeartbeat(enabled: boolean): void {
  useEffect(() => { if (enabled) socialPulsePoll.refresh(true); }, [enabled]);
}

/**
 * Avisa de que el estado social cambió (tras una acción): relee el pulso en ESTA pestaña y avisa a las DEMÁS pestañas del
 * mismo navegador (BroadcastChannel), que releen el suyo y, si su `version` cambia, su hub. Multi-dispositivo converge
 * por el pulso (≤ 20 s).
 */
const CHANNEL = "nexus-social";
let channel: BroadcastChannel | null = null;
function bc(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => { try { window.dispatchEvent(new Event("nexus:social-changed")); } catch { /* sin ventana */ } };
  }
  return channel;
}
if (typeof window !== "undefined") bc();

export function announceSocialChange(): void {
  try { window.dispatchEvent(new Event("nexus:social-changed")); } catch { /* sin ventana */ }
  try { bc()?.postMessage({ at: Date.now() }); } catch { /* sin canal */ }
}
