/**
 * RECOMPENSA DE PRIMERA VICTORIA (Fase 35) — la ÚNICA economía de la campaña.
 *
 *   · Solo créditos existentes, por el único camino de concesión (`services/rewards.award` → `app_grant_reward`).
 *   · Una vez en la vida por nodo: la clave de idempotencia es `campaign:<campaignId>:<nodeId>` y NO lleva
 *     versión, así que publicar `rtc-2` no vuelve a pagar un nodo ya cobrado.
 *   · Acotada: la suma de toda la campaña está por debajo de `CAMPAIGN_FIRST_CLEAR_CAP`.
 *   · Rejugar no paga nada extra. La partida en sí paga lo de SIEMPRE (tabla PvE + tope diario de 20), igual
 *     que una partida rápida: la campaña no abre una segunda granja.
 *
 * Sin moneda nueva, sin sobre de campaña, sin cartas, sin stamina, sin tickets.
 */
import type { CampaignDefinition, CampaignNodeType } from "./types";

export const FIRST_CLEAR_CREDITS: Record<CampaignNodeType, number> = { MATCH: 50, ELITE: 100, BOSS: 200 };

/** Techo de TODA la campaña. Un Sobre Estándar cuesta 750: la campaña entera da menos de dos. */
export const CAMPAIGN_FIRST_CLEAR_CAP = 1500;

export const CAMPAIGN_REWARD_REASON = "campaign_first_clear";

export function firstClearRef(campaignId: string, nodeId: string): string {
  return `campaign:${campaignId}:${nodeId}`;
}

export function campaignRewardTotal(def: CampaignDefinition): number {
  return def.chapters.reduce((s, c) => s + c.nodes.reduce((n, x) => n + x.rewards.firstClear.credits, 0), 0);
}
