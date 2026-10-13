import type { Reward } from "@/domain/events/types";
import { formatCredits } from "@/lib/format";

/** Resumen compacto y legible de una recompensa. */
export function rewardSummary(reward: Reward): string {
  const parts: string[] = [];
  if (reward.credits) parts.push(`${formatCredits(reward.credits)} créditos`);
  if (reward.xp) parts.push(`✨ ${reward.xp} XP`);
  if (reward.packId) parts.push(`📦 ${reward.packCount ?? 1}× ${reward.packId}`);
  if (reward.cardId) parts.push("🃏 carta exclusiva");
  return parts.length ? parts.join(" · ") : "—";
}
