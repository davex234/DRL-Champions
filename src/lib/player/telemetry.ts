/**
 * TELEMETRÍA DEL PERFIL (Fase 31) — cinco momentos como CONTEXTOS de `flow_started`.
 *
 * El contrato de flujos sigue cerrado (CHECK 0029). La migración local 0046 (NO aplicada) reserva
 * `player_profile` junto a los flujos de fases anteriores. Hasta que exista en la base de datos Y
 * en `FLOWS`, este módulo es un no-op honesto: cableado, sin falsear.
 */
import { trackFlow } from "@/lib/telemetry/client";
import { isFlow, type Flow } from "@/lib/telemetry/contract";

export const PROFILE_CONTEXTS = ["profile_view", "profile_edit", "showcase_edit", "showcase_card_view", "achievement_feature"] as const;
export type ProfileContext = (typeof PROFILE_CONTEXTS)[number];

export const PROFILE_FLOW = "player_profile";

export function profileFlow(): Flow | null {
  return isFlow(PROFILE_FLOW) ? PROFILE_FLOW : null;
}

export function trackProfile(context: ProfileContext): void {
  try {
    const flow = profileFlow();
    if (!flow) return;
    trackFlow(flow, context);
  } catch { /* nunca tumba la pantalla */ }
}
