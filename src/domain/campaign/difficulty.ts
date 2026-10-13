/**
 * DIFICULTAD DE CAMPAÑA → DIFICULTAD CANÓNICA (Fase 35).
 *
 * No hay IA nueva ni trampas de jefe. Solo dos palancas que YA existían:
 *   1. el perfil del bot canónico (`DIFFICULTY_PROFILE`: EASY 0 · NORMAL 0.5 · HARD 0.85 de heurística, sin
 *      información perfecta en ningún nivel);
 *   2. QUÉ versión de cada jugador real trae el rival (la de menor, mediana o mayor OVR del catálogo).
 *
 * Regla, fija y comprobada por `validateCampaign`:
 *   capítulo 1 → ROOKIE (EASY)  · cartas BASE
 *   capítulo 2 → PRO (NORMAL)   · cartas MID
 *   capítulo 3 → CHAMPION (HARD)· cartas TOP
 *   ELITE      → un escalón de bot por encima del capítulo (tope CHAMPION), mismas cartas
 *   BOSS       → un escalón de bot y un escalón de cartas por encima (tope CHAMPION/TOP)
 */
import type { BotDifficulty, CampaignNodeType, CampaignTier, CardTier } from "./types";

export const CAMPAIGN_TIERS: readonly CampaignTier[] = ["ROOKIE", "PRO", "CHAMPION"];
const CARD_TIERS: readonly CardTier[] = ["BASE", "MID", "TOP"];

export const TIER_TO_BOT: Record<CampaignTier, BotDifficulty> = { ROOKIE: "EASY", PRO: "NORMAL", CHAMPION: "HARD" };

export const TIER_LABEL: Record<CampaignTier, string> = { ROOKIE: "Novato", PRO: "Profesional", CHAMPION: "Campeón" };

/** Etiqueta canónica del bot, la misma que usa la pre-partida rápida («Fácil», «Normal», «Difícil»). */
export const BOT_LABEL: Record<BotDifficulty, string> = { EASY: "Fácil", NORMAL: "Normal", HARD: "Difícil" };

export const CARD_TIER_LABEL: Record<CardTier, string> = { BASE: "Versiones base", MID: "Versiones intermedias", TOP: "Mejores versiones" };

export const NODE_TYPE_LABEL: Record<CampaignNodeType, string> = { MATCH: "Partida", ELITE: "Élite", BOSS: "Jefe" };

const clampStep = <T>(list: readonly T[], i: number): T => list[Math.max(0, Math.min(list.length - 1, i))];

/** Escalón base de un capítulo (1-indexado). Capítulos fuera de rango se tratan como el último. */
function chapterIndex(chapterOrder: number): number {
  return Math.max(0, Math.min(CAMPAIGN_TIERS.length - 1, Math.trunc(chapterOrder) - 1));
}

export function expectedTier(chapterOrder: number, type: CampaignNodeType): CampaignTier {
  const base = chapterIndex(chapterOrder);
  return clampStep(CAMPAIGN_TIERS, type === "MATCH" ? base : base + 1);
}

export function cardTierFor(chapterOrder: number, type: CampaignNodeType): CardTier {
  const base = chapterIndex(chapterOrder);
  return clampStep(CARD_TIERS, type === "BOSS" ? base + 1 : base);
}

export const botDifficultyOf = (tier: CampaignTier): BotDifficulty => TIER_TO_BOT[tier];
