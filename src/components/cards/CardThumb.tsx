"use client";

import type { CardDef } from "@/domain/cards/types";
import { getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { variantIdentity } from "@/design/variantIdentity";
import { VariantSeal } from "./layers/VariantSeal";
import { CardArt } from "./CardArt";

/**
 * Miniatura compacta de una carta para filas de listas (mercado, historial).
 *
 * A 44 px no cabe una carta: cabe un IDENTIFICADOR. Lo que sí tiene que sobrevivir a este
 * tamaño es saber que la carta es especial y de qué tipo — si no, una `clutch` /120 y una
 * `bronze` son la misma fila con distinto borde.
 *
 * Por eso la miniatura lleva el mismo sello que la carta grande, en 9 px, y en la familia TOP
 * el código corto (`RAT`, `ACS`, `K`, `A`, `HS`), que es el único sitio del sistema donde ese
 * código hace falta: en la carta el nombre completo cabe y el código sobraría.
 *
 * No se convierte en una carta completa a propósito: sin estadísticas, sin nombre, sin serial.
 */
export function CardThumb({ card, width = 44 }: { card: CardDef; width?: number }) {
  const player = getPlayer(card.playerId);
  const variant = getVariant(card.variantId);
  if (!player) return null;
  const identidad = variantIdentity(card.variantId);

  /*
   * CATÁLOGO DISEÑADO: la miniatura es la propia carta reducida, con el mismo ANCHO para que
   * ninguna fila cambie de medida. CARD ART = CARD VISUAL: sin borde de rareza, sin radio y sin
   * recorte — el asset tal cual, con su sombra. Sin imagen, el identificador de siempre.
   */
  if (card.image) {
    return (
      <div className="relative shrink-0" style={{ width }} data-card-image={card.id}>
        <CardArt src={card.image} alt={`${player.nick} · ${variant.label}`} shadow={width >= 60 ? "rest" : "none"} />
      </div>
    );
  }

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

      {/*
        El sello, abajo a la derecha, sobre una placa opaca. La placa no es adorno: la
        miniatura hereda el fondo de la paleta, y sobre las claras (`icon`, `champion`) un
        trazo del color primario desaparece.
      */}
      {identidad.seal && (
        <span
          className="absolute bottom-0 right-0 flex items-center gap-[2px] rounded-tl-[3px] px-[3px] py-[1px]"
          style={{ background: "rgba(6,8,14,0.88)", color: variant.palette.secondary }}
        >
          <VariantSeal shape={identidad.seal} size={9} label={identidad.sealLabel} />
          {identidad.code && (
            <span className="font-display text-[7px] font-bold leading-none tracking-tight">
              {identidad.code}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
