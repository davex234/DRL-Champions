"use client";

import type { Reward } from "@/domain/events/types";
import { getPack } from "@/data/packs";
import { getCard, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { formatCredits } from "@/lib/format";

/** Muestra una recompensa como una lista de chips legibles. */
export function RewardChips({ reward }: { reward: Reward }) {
  const chips: { icon: string; text: string }[] = [];
  if (reward.credits) chips.push({ icon: "🪙", text: formatCredits(reward.credits) });
  if (reward.tokens) chips.push({ icon: "🎟️", text: String(reward.tokens) });
  if (reward.xp) chips.push({ icon: "✨", text: `${reward.xp} XP` });
  if (reward.packId) {
    const pack = getPack(reward.packId);
    chips.push({ icon: "📦", text: `${pack?.name ?? reward.packId}${reward.packCount && reward.packCount > 1 ? ` x${reward.packCount}` : ""}` });
  }
  if (reward.cardId) {
    const card = getCard(reward.cardId);
    const player = card ? getPlayer(card.playerId) : undefined;
    const variant = card ? getVariant(card.variantId) : undefined;
    chips.push({ icon: "🃏", text: card ? `${player?.nick} ${variant?.label}` : reward.cardId });
  }
  if (chips.length === 0) chips.push({ icon: "🎖️", text: "Cosmético" });

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-md bg-white/8 px-2 py-0.5 text-xs font-semibold text-white/80"
        >
          <span>{c.icon}</span>
          {c.text}
        </span>
      ))}
    </div>
  );
}
