"use client";

import { useEffect, useState } from "react";
import type { Player, RarityPalette } from "@/domain/cards/types";
import { playerImageSrc } from "@/lib/assets";
import { PlayerSigil } from "./PlayerSigil";

/**
 * Fotos que ya se sabe que NO existen, recordadas durante esta sesión.
 *
 * Sin esto, cada vez que una carta se monta se vuelve a pedir un PNG que ya falló. En una pantalla
 * con diez o veinte cartas —la colección, el constructor de mazos, un duelo— eso son decenas de
 * peticiones inútiles por render, y el navegador se queda ocupado esperándolas (medido: 10 cartas,
 * 3,5 s de peticiones a 404). Recordar el fallo hace que se intente UNA vez por jugador y sesión.
 *
 * Es una caché en memoria a propósito: si más adelante se publica el artwork, basta con recargar
 * para que se vuelva a intentar. No cambia el resultado visual, solo deja de pagarlo dos veces.
 */
const missingPhotos = new Set<string>();

/**
 * Capa de retrato. Carga `/players/{id}.png` (PNG transparente) y, si no existe, dibuja el
 * SIGILO del jugador: un emblema geométrico propio, distinto para cada uno.
 *
 * Antes el respaldo era una silueta genérica —círculo, hombros y dos iniciales—, idéntica
 * en todas las cartas. Como no hay retratos, esa silueta ERA la carta: 772 cartas con la
 * misma imagen. Es lo que hacía que la colección se leyera como una hoja de cálculo con
 * colores en vez de como una colección.
 *
 * Cuando existan retratos autorizados, la foto vuelve a ganar y el sigilo no se dibuja. No
 * hay que deshacer nada.
 */
export function PlayerPhoto({
  player,
  palette,
  rank = 1,
  rich = false,
}: {
  player: Player;
  palette: RarityPalette;
  /** Rango de la variante: el sigilo se hace más denso con la rareza. */
  rank?: number;
  /** Efectos caros (desenfoque). Solo en cartas grandes. */
  rich?: boolean;
}) {
  const src = playerImageSrc(player);
  const [failed, setFailed] = useState(() => missingPhotos.has(src));

  // Reinicia el estado si cambia el jugador (y respeta lo que ya se sabe de esa foto).
  useEffect(() => setFailed(missingPhotos.has(src)), [src]);

  if (!failed) {
    return (
      <img
        src={src}
        alt={player.nick}
        onError={() => { missingPhotos.add(src); setFailed(true); }}
        className="absolute inset-x-0 bottom-0 mx-auto h-full w-auto max-w-full object-contain object-bottom drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)]"
        draggable={false}
      />
    );
  }

  return <PlayerSigil player={player} palette={palette} rank={rank} rich={rich} />;
}
