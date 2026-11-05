/**
 * TELEMETRÍA DE LIVE EVENTS (Fase 30) — cinco momentos como CONTEXTOS de `flow_started`.
 *
 * El contrato de flujos sigue cerrado (CHECK 0029). La migración local 0046 (NO aplicada)
 * reserva `live_events` junto a los flujos de fases anteriores. Hasta que exista en la base de
 * datos Y en `FLOWS`, este módulo es un no-op honesto: cableado, sin falsear.
 */
import { trackFlow } from "@/lib/telemetry/client";
import { isFlow, type Flow } from "@/lib/telemetry/contract";

export const LIVE_EVENT_CONTEXTS = ["event_view", "event_match_view", "event_pickem_cta", "event_collection_cta", "event_pack_cta"] as const;
export type LiveEventContext = (typeof LIVE_EVENT_CONTEXTS)[number];

export const LIVE_EVENTS_FLOW = "live_events";

export function liveEventsFlow(): Flow | null {
  return isFlow(LIVE_EVENTS_FLOW) ? LIVE_EVENTS_FLOW : null;
}

export function trackLiveEvent(context: LiveEventContext): void {
  try {
    const flow = liveEventsFlow();
    if (!flow) return;
    trackFlow(flow, context);
  } catch { /* nunca tumba la pantalla */ }
}
