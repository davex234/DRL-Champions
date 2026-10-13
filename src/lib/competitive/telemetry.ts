/**
 * TELEMETRÍA DEL COMPETITIVO (Fase 28) — seis momentos como CONTEXTOS de `flow_started`.
 *
 * El contrato de flujos sigue cerrado (CHECK 0029). La migración local 0046 (NO aplicada) reserva
 * `competitive` junto a `duel_play` y `progression`. Hasta que exista en la base de datos Y en
 * `FLOWS`, este módulo es un no-op honesto: cableado, sin falsear.
 */
import { trackFlow } from "@/lib/telemetry/client";
import { isFlow, type Flow } from "@/lib/telemetry/contract";

export const COMPETITIVE_CONTEXTS = [
  "competitive_view", "leaderboard_view", "history_view", "match_detail_view", "queue_start", "queue_cancel",
] as const;
export type CompetitiveContext = (typeof COMPETITIVE_CONTEXTS)[number];

export const COMPETITIVE_FLOW = "competitive";

export function competitiveFlow(): Flow | null {
  return isFlow(COMPETITIVE_FLOW) ? COMPETITIVE_FLOW : null;
}

export function trackCompetitive(context: CompetitiveContext): void {
  try {
    const flow = competitiveFlow();
    if (!flow) return;
    trackFlow(flow, context);
  } catch { /* nunca tumba la pantalla */ }
}
