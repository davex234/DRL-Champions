"use client";

import type { CardDef } from "@/domain/cards/types";
import { getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { cn } from "@/lib/format";
import { CardRenderer, CHAMFER, SIZE_W, type CardSize } from "./CardRenderer";
import { CardFace } from "./CardVisual";

/**
 * Adaptador: toma una definición de carta del catálogo y la pinta. Mantiene la API usada en
 * toda la app.
 *
 * CATÁLOGO DISEÑADO (2026-09-21): una carta que trae su IMAGEN (`card.image`, derivado web de
 * `Cartas\`) se enseña tal cual —es la carta, con su OVR, su rol y sus estadísticas impresos—,
 * con el mismo ancho que el dibujado por capas para que ninguna rejilla cambie de medida. Si la
 * imagen falla, `CardFace` cae al dibujado por capas de siempre: nunca una imagen rota.
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

  const capas = (
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
  if (!card.image) return capas;

  return (
    <div className={cn("relative select-none", SIZE_W[size], className)} data-card-image={card.id}>
      <CardFace
        artwork={{ url: card.image, cardId: card.id, cardVersion: 1, format: "webp" }}
        alt={`${player.nick} · ${variant.label}`}
        chamfer={CHAMFER[size]}
      >
        {/* Respaldo si la imagen no carga: el mismo dibujado de siempre, sin la clase exterior. */}
        <CardRenderer
          player={player} variant={variant} stats={card.stats} ovr={card.ovr} serial={serial}
          size={size} interactive={interactive} showStats={showStats} effects={effects}
        />
      </CardFace>
    </div>
  );
}
