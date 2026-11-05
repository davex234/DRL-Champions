/**
 * TELEMETRÍA DE LA EXPERIENCIA DE PARTIDA (Fase 33) — contextos de `flow_started` en `duel_play`.
 *
 * `duel_play` sigue fuera del contrato cerrado (CHECK 0029; reservado en la 0046, NO aplicada), así
 * que este módulo es un no-op honesto, igual que `trackDuel`. Va aparte de `DUEL_CONTEXTS` porque esa
 * lista está fijada por contrato (orden y uso exactos) y no se toca.
 */
import { trackFlow } from "@/lib/telemetry/client";
import { isFlow, type Flow } from "@/lib/telemetry/contract";

export const EXPERIENCE_CONTEXTS = [
  "match_intro_view", "turn_card_select", "turn_lock", "turn_reveal", "turn_result_view",
  "match_result_view", "replay_open", "rematch_click",
] as const;
export type ExperienceContext = (typeof EXPERIENCE_CONTEXTS)[number];

export const EXPERIENCE_FLOW = "duel_play";

export function experienceFlow(): Flow | null {
  return isFlow(EXPERIENCE_FLOW) ? EXPERIENCE_FLOW : null;
}

export function trackExperience(context: ExperienceContext): void {
  try {
    const flow = experienceFlow();
    if (!flow) return;
    trackFlow(flow, context);
  } catch { /* nunca tumba la partida */ }
}
