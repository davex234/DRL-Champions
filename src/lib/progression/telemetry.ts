/**
 * TELEMETRÍA DEL META (Fase 27) — siete momentos como CONTEXTOS de `flow_started`.
 *
 * La taxonomía de flujos es un conjunto cerrado (contrato + `CHECK` 0029). `progression` no está
 * en ella; la migración local `0046_telemetry_flows_progression.sql` la amplía (NO aplicada). Hasta
 * que exista en la base de datos Y en `FLOWS`, emitir sería falsear (rechazado en el borde y en el
 * CHECK). Por eso este módulo está cableado y SOLO emite cuando el contrato admita el flujo.
 */
import { trackFlow } from "@/lib/telemetry/client";
import { isFlow, type Flow } from "@/lib/telemetry/contract";

export const META_CONTEXTS = [
  "progression_view",
  "objective_view",
  "objective_completed",
  "achievement_view",
  "level_up",
  "reward_view",
  "continue_action",
] as const;
export type MetaContext = (typeof META_CONTEXTS)[number];

export const META_FLOW = "progression";

export function metaFlow(): Flow | null {
  return isFlow(META_FLOW) ? META_FLOW : null;
}

export function trackMeta(context: MetaContext): void {
  try {
    const flow = metaFlow();
    if (!flow) return;
    trackFlow(flow, context);
  } catch { /* nunca tumba la pantalla */ }
}
