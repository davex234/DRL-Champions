"use client";

import type { CardDef } from "@/domain/cards/types";
import { getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";

/** Miniatura compacta de una carta para filas de listas (mercado, historial). */
export function CardThumb({ card, width = 44 }: { card: CardDef; width?: number }) {
  const player = getPlayer(card.playerId);
  const variant = getVariant(card.variantId);
  if (!player) return null;
  return (
    <div
      className="relative grid place-items-center overflow-hidden rounded-md border"
      style={{
        width,
        aspectRatio: "5 / 7",
        borderColor: variant.palette.primary,
        background: variant.palette.background,
        color: variant.palette.text,
      }}
    >
      <span className="absolute left-1 top-0.5 font-display text-xs font-bold leading-none">
        {card.ovr}
      </span>
      <span className="font-display text-sm font-bold leading-none">
        {player.nick.slice(0, 2).toUpperCase()}
      </span>
    </div>
  );
}
