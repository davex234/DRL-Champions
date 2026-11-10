/**
 * TELEMETRÍA SOCIAL (Fase 29) — siete momentos como CONTEXTOS de `flow_started`.
 *
 * El contrato de flujos sigue cerrado (CHECK 0029). La migración local 0046 (NO aplicada) reserva
 * `social` junto a `duel_play`, `progression` y `competitive`. Hasta que exista en la base de
 * datos Y en `FLOWS`, este módulo es un no-op honesto: cableado, sin falsear.
 */
import { trackFlow } from "@/lib/telemetry/client";
import { isFlow, type Flow } from "@/lib/telemetry/contract";

export const SOCIAL_CONTEXTS = [
  "social_view", "player_search", "friend_request", "friend_accept", "challenge_sent", "challenge_accept", "private_match_complete",
] as const;
export type SocialContext = (typeof SOCIAL_CONTEXTS)[number];

export const SOCIAL_FLOW = "social";

export function socialFlow(): Flow | null {
  return isFlow(SOCIAL_FLOW) ? SOCIAL_FLOW : null;
}

export function trackSocial(context: SocialContext): void {
  try {
    const flow = socialFlow();
    if (!flow) return;
    trackFlow(flow, context);
  } catch { /* nunca tumba la pantalla */ }
}
