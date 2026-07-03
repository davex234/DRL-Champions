/**
 * Aplicación de recompensas compartida (créditos / xp / sobres / carta / tokens).
 *
 * Centraliza el patrón que `useEventsStore` usa en su `grantReward` privado para
 * que otros sistemas (Collection Engine) concedan recompensas de forma idéntica.
 */
import type { Reward } from "@/domain/events/types";
import { useGameStore } from "@/store/useGameStore";
import { useEventsStore } from "@/store/useEventsStore";

export function applyReward(reward: Reward): void {
  const game = useGameStore.getState();
  if (reward.credits) game.addCredits(reward.credits);
  if (reward.xp) game.addXp(reward.xp);
  if (reward.packId) game.grantPack(reward.packId, reward.packCount ?? 1);
  if (reward.cardId) game.grantCard(reward.cardId);
  // Battle Pass (Fase 6/7): materiales y cosméticos por la MISMA ruta (sin otra vía de adquisición).
  if (reward.materials) game.addMaterials(reward.materials);
  if (reward.cosmetics && reward.cosmetics.length) game.addCosmetics(reward.cosmetics);
  if (reward.tokens) {
    const tokens = (useEventsStore.getState() as { tokens: number }).tokens;
    useEventsStore.setState({ tokens: tokens + reward.tokens } as Partial<ReturnType<typeof useEventsStore.getState>>);
  }
}
