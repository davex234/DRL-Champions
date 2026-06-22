"use client";

import { useEffect, useState } from "react";
import type { Player, RarityPalette } from "@/domain/cards/types";
import { playerImageSrc } from "@/lib/assets";

/**
 * Capa de foto del jugador. Carga `/players/{id}.png` (PNG transparente),
 * escalada y centrada automáticamente. Si no existe, muestra una silueta
 * por defecto con las iniciales y los colores de la variante.
 */
export function PlayerPhoto({
  player,
  palette,
}: {
  player: Player;
  palette: RarityPalette;
}) {
  const src = playerImageSrc(player);
  const [failed, setFailed] = useState(false);

  // Reinicia el estado si cambia el jugador.
  useEffect(() => setFailed(false), [src]);

  if (!failed) {
    return (
      <img
        src={src}
        alt={player.nick}
        onError={() => setFailed(true)}
        className="absolute inset-x-0 bottom-0 mx-auto h-full w-auto max-w-full object-contain object-bottom drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)]"
        draggable={false}
      />
    );
  }

  // Silueta por defecto (genérica) + iniciales.
  return (
    <div className="absolute inset-0 grid place-items-end justify-items-center">
      <svg viewBox="0 0 100 120" className="h-[88%] w-auto opacity-90" aria-hidden>
        <defs>
          <linearGradient id={`sil-${player.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.secondary} stopOpacity="0.55" />
            <stop offset="100%" stopColor={palette.primary} stopOpacity="0.15" />
          </linearGradient>
        </defs>
        {/* Cabeza */}
        <circle cx="50" cy="38" r="22" fill={`url(#sil-${player.id})`} />
        {/* Hombros / busto */}
        <path
          d="M12 120 C12 86 30 70 50 70 C70 70 88 86 88 120 Z"
          fill={`url(#sil-${player.id})`}
        />
      </svg>
      <span
        className="absolute top-[26%] font-display text-3xl font-bold opacity-90"
        style={{ color: palette.text }}
      >
        {player.nick.slice(0, 2).toUpperCase()}
      </span>
    </div>
  );
}
