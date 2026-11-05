/**
 * TELEMETRÍA DE CAMPAÑA Y MODOS (Fase 35) — siete momentos como CONTEXTOS de `flow_started` en `campaign`.
 *
 * `campaign` está reservado en la migración local 0046 (NO aplicada) y no está en `FLOWS` (contrato cerrado,
 * CHECK 0029). Hasta que existan los dos, emitir sería falsear: este módulo es un no-op honesto, igual que
 * `trackSeason`, `trackMeta` y `trackExperience`. Sin claves nuevas, sin identificadores de usuario.
 */
import { trackFlow } from "@/lib/telemetry/client";
import { isFlow, type Flow } from "@/lib/telemetry/contract";

export const CAMPAIGN_CONTEXTS = [
  "game_modes_view", "campaign_open", "campaign_node_open", "campaign_match_start",
  "campaign_node_complete", "campaign_replay", "campaign_chapter_complete",
] as const;
export type CampaignContext = (typeof CAMPAIGN_CONTEXTS)[number];

export const CAMPAIGN_FLOW = "campaign";

export function campaignFlow(): Flow | null {
  return isFlow(CAMPAIGN_FLOW) ? CAMPAIGN_FLOW : null;
}

export function trackCampaign(context: CampaignContext): void {
  try {
    const flow = campaignFlow();
    if (!flow) return;
    trackFlow(flow, context);
  } catch { /* nunca tumba la pantalla */ }
}
