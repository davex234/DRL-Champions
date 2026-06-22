"use client";

import type { CardDef } from "@/domain/cards/types";
import { getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { CardRenderer, type CardSize } from "./CardRenderer";

/**
 * Adaptador: toma una definición de carta del catálogo y la renderiza con el
 * motor por capas (CardRenderer). Mantiene la API usada en toda la app.
 */
export function PlayerCard({
  card,
  size = "md",
  serial,
  interactive = true,
  showStats = true,
  effects,
  className,
}: {
  card: CardDef;
  size?: CardSize;
  serial?: number;
  interactive?: boolean;
  showStats?: boolean;
  effects?: boolean;
  className?: string;
}) {
  const player = getPlayer(card.playerId);
  const variant = getVariant(card.variantId);
  if (!player) return null;

  return (
    <CardRenderer
      player={player}
      variant={variant}
      stats={card.stats}
      ovr={card.ovr}
      serial={serial}
      size={size}
      interactive={interactive}
      showStats={showStats}
      effects={effects}
      className={className}
    />
  );
}
