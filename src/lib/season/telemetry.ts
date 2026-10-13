/**
 * TELEMETRÍA DE TEMPORADA (Fase 34) — seis momentos como CONTEXTOS de `flow_started` en `season`.
 *
 * `season` está reservado en la migración local 0046 (NO aplicada) y no está en `FLOWS` (contrato
 * cerrado, CHECK 0029). Hasta que existan los dos, emitir sería falsear: este módulo es un no-op
 * honesto, igual que `trackMeta` y `trackExperience`.
 */
import { trackFlow } from "@/lib/telemetry/client";
import { isFlow, type Flow } from "@/lib/telemetry/contract";

export const SEASON_CONTEXTS = [
  "season_hub_view", "season_pass_open", "season_objective_open", "season_ranked_open", "season_event_open", "season_recap_view",
] as const;
export type SeasonContext = (typeof SEASON_CONTEXTS)[number];

export const SEASON_FLOW = "season";

export function seasonFlow(): Flow | null {
  return isFlow(SEASON_FLOW) ? SEASON_FLOW : null;
}

export function trackSeason(context: SeasonContext): void {
  try {
    const flow = seasonFlow();
    if (!flow) return;
    trackFlow(flow, context);
  } catch { /* nunca tumba la pantalla */ }
}
