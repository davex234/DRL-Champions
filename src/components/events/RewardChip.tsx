"use client";

import type { Reward } from "@/domain/events/types";
import { getPack } from "@/data/packs";
import { getCard, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { formatCredits } from "@/lib/format";
import { GameGlyph } from "@/components/ui/game/GameGlyph";
import { td, ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("events");

/** Muestra una recompensa como una lista de chips legibles. */
export function RewardChips({ reward }: { reward: Reward }) {
  useLocale();
  const chips: { icon: string; text: string }[] = [];
  if (reward.credits) chips.push({ icon: "🪙", text: formatCredits(reward.credits) });
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
  /*
   * El cosmético se pinta por lo que la recompensa DICE que da, no por descarte.
   *
   * Antes esto era `if (chips.length === 0) chips.push({ icon: "🎖️", text: "Cosmético" })`:
   * cualquier recompensa sin chips salía anunciando un cosmético. Funcionaba mientras la
   * única recompensa sin chips fuese, de hecho, cosmética. Al retirarse las fichas de
   * evento (F18.2) unas cuantas recompensas se quedaron vacías, y el descarte las convirtió
   * en la promesa de un cosmético que nadie va a entregar.
   */
  if (reward.cosmetics?.length) {
    chips.push({ icon: "🎖️", text: reward.cosmetics.length > 1 ? t("{length} cosméticos", { length: reward.cosmetics.length }) : t("Cosmético") });
  }
  if (reward.materials && Object.keys(reward.materials).length > 0) {
    chips.push({ icon: "🧪", text: t("Materiales") });
  }
  /* Y una recompensa que no da nada lo dice, en vez de inventarse un premio. */
  if (chips.length === 0) chips.push({ icon: "—", text: t("Sin premio") });

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-md bg-white/8 px-2 py-0.5 text-xs font-semibold text-white/80"
        >
          <GameGlyph symbol={c.icon} className="h-[1.1em] w-[1.1em]" />
          {td(c.text)}
        </span>
      ))}
    </div>
  );
}
