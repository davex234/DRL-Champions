"use client";

/**
 * LA MANO — las cartas que sostienes, y las que sostiene el rival.
 *
 * ────────────────────────── FASE 50 · UNA MANO DE CARTAS DE VERDAD ──────────────────────────
 *
 * La mano de la Fase 45 ya se solapaba y se levantaba, pero con cartas de 76 px y un abanico de
 * ±5° seguía leyéndose como una fila de miniaturas. Ahora:
 *
 *   · las cartas son la segunda cosa más grande de la pantalla (después del duelo): hasta 112 px;
 *   · el abanico es un ARCO: las de los extremos giran y caen más, como sostenidas con una mano;
 *   · al pasar por encima la carta sube, crece un poco y sus vecinas se apartan;
 *   · la elegida sube del todo, se endereza y se enciende en cian (el color del jugador);
 *   · cada carta brilla con el color de su RAREZA (la paleta de su variante, la de siempre).
 *
 * ────────────────────────── EL HITBOX (lección de fases anteriores) ──────────────────────────
 *
 * Lo que se levanta es la carta, no su hueco: el envoltorio de cada carta NO se transforma, así que
 * el puntero no «pierde» la carta al subir, y el hueco que deja debajo sigue eligiéndola (el
 * envoltorio reenvía el clic cuando cae en su propio fondo). El control accesible sigue siendo el
 * `<button>` de la carta: teclado, foco y nombre no cambian.
 *
 * ────────────────────────── LO QUE NO SE PUEDE VER ──────────────────────────
 *
 * `RivalHand` pinta REVERSOS, tantos como diga `view.rivalRemaining`, que es lo único que el
 * servidor cuenta del rival: cuántas cartas le quedan es público, cuáles son no lo es. El
 * componente no recibe cartas: recibe un número.
 *
 * ────────────────────────── MÓVIL Y TÁCTIL ──────────────────────────
 *
 * Sin hover: el primer toque elige la carta (como siempre) y la confirmación sigue siendo el botón.
 * El abanico se cierra y la fila se desplaza en horizontal dentro de su carril, sin desbordar la
 * página. Con movimiento reducido nada viaja: la carta elegida llega ya levantada.
 */
import { useState } from "react";
import { cn } from "@/lib/format";
import { getVariant } from "@/domain/cards/variants";
import { DuelCard, DuelCardBack } from "../DuelCard";
import type { CombatStatKey, DuelDeckCardDTO, RivalCardHint } from "@/lib/duel/types";
import type { RoleId } from "@/domain/cards/types";

/** Cian del jugador, el mismo de la arena. */
const CIAN = "#2fe0ff";

export function PlayerHand({
  cards, selectedUid, highlightStat, onPick, disabled, className,
}: {
  cards: DuelDeckCardDTO[];
  selectedUid: string | null;
  /** Eje a resaltar. Defendiendo lo fija el servidor; atacando, solo en la elegida. */
  highlightStat: (card: DuelDeckCardDTO) => CombatStatKey | null;
  onPick?: (uid: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);

  if (cards.length === 0) {
    return (
      <div className={cn("grid min-h-[120px] place-items-center", className)}>
        <span className="font-display text-[10px] uppercase tracking-[0.24em] text-white/25">
          Sin cartas en la mano
        </span>
      </div>
    );
  }

  const n = cards.length;
  /* Un arco, no una fila: con diez cartas ±12°; con pocas, casi rectas. */
  const maxAngle = Math.min(6, 28 / Math.max(n, 1));

  return (
    <div
      className={cn(
        /*
         * En móvil el carril se desplaza (`overflow-x-auto`, que obliga a recortar en vertical);
         * a partir de `sm` la mano cabe entera y el carril deja de recortar, así que la carta que
         * se levanta puede asomar por encima de la mano sin cortarse.
         */
        "flex items-end gap-0 overflow-x-auto overflow-y-hidden px-2 sm:justify-center sm:overflow-visible",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "pt-[clamp(22px,3vh,30px)] pb-[clamp(4px,0.8vh,10px)] sm:pt-[clamp(14px,2vh,22px)]",
        className,
      )}
      style={{ perspective: 1200 }}
      role="group"
      aria-label="Tu mano"
    >
      {cards.map((c, i) => {
        const centro = (n - 1) / 2;
        const off = i - centro;
        const angle = n > 1 ? off * maxAngle : 0;
        // Las de los extremos caen más: es la curva lo que hace que un abanico parezca sostenido.
        const drop = n > 1 ? off * off * 0.9 : 0;
        const on = selectedUid === c.uid;
        const up = hover === c.uid;
        /* Con una carta elegida, el resto de la mano pierde énfasis (sigue pulsable). */
        const dim = selectedUid !== null && !on && !up;
        const rareza = getVariant(c.variantId).palette.primary;

        return (
          <div
            key={c.uid}
            data-hand-card={c.uid}
            /*
             * EL ENVOLTORIO NO SE MUEVE. Es el hueco de la carta en la mano: recoge el hover y, si el
             * clic cae en su fondo (el sitio que la carta dejó al levantarse), elige la carta igual.
             * El `<button>` de la carta sigue siendo el control; esto solo tapa el hueco.
             */
            onClick={(e) => { if (!disabled && e.target === e.currentTarget) onPick?.(c.uid); }}
            className="relative shrink-0 transition-[margin] duration-fast motion-reduce:transition-none"
            style={{
              // Solapado: se separan al pasar por encima, como al abrir la mano.
              marginLeft: i === 0 ? 0 : up || on ? "-4px" : "clamp(-30px, -2.2vw, -16px)",
              zIndex: on ? 40 : up ? 30 : i,
            }}
            onMouseEnter={() => setHover(c.uid)}
            onMouseLeave={() => setHover((h) => (h === c.uid ? null : h))}
          >
            <div
              className="pointer-events-auto origin-bottom transition-[transform,opacity,filter] duration-normal ease-out motion-reduce:transition-none"
              style={{
                opacity: dim ? 0.6 : 1,
                transform: on
                  ? "translateY(-24px) rotate(0deg) scale(1.1)"
                  : up
                    ? `translateY(-16px) rotate(${angle * 0.3}deg) scale(1.07)`
                    : `translateY(${drop}px) rotate(${angle}deg)`,
                filter: on
                  ? `drop-shadow(0 0 14px ${CIAN}) drop-shadow(0 22px 26px rgba(0,0,0,0.8))`
                  : up
                    ? `drop-shadow(0 0 12px ${rareza}aa) drop-shadow(0 18px 22px rgba(0,0,0,0.75))`
                    : `drop-shadow(0 0 7px ${rareza}55) drop-shadow(0 10px 16px rgba(0,0,0,0.65))`,
              }}
            >
              <DuelCard
                card={c}
                size="sm"
                selected={on}
                highlightStat={highlightStat(c)}
                onClick={disabled ? undefined : () => onPick?.(c.uid)}
                /*
                 * La segunda carta más grande de la pantalla, detrás de las del duelo. Encoge en
                 * pantallas bajas —nunca por debajo de 62 px, que sigue siendo cómodo de pulsar—
                 * porque la mano es lo último que entra en el viewport y lo primero que hay que ver.
                 */
                className="!w-[clamp(62px,min(10.6vh,8vw),108px)]"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * La mano del rival: reversos NEXUS, y solo reversos.
 *
 * Recibe un NÚMERO, no cartas. Es la garantía estructural de que esta pantalla no puede
 * filtrar lo que el rival no ha jugado todavía: no tiene el dato.
 *
 * F71 · y, como mucho, UNA PISTA por dorso (`{ type, value }`: país, liga, equipo o rol) que ya
 * calculó el servidor. Solo se pintan si hay exactamente una por carta oculta.
 */
/**
 * EL HALO DE LOS DORSOS: rosa del rival + sombra de caída.
 *
 * F72.6 · con pistas dejó de ir en cada dorso: el `drop-shadow` del envoltorio de la carta i+1 (que va por encima,
 * `zIndex: i+1`) se pintaba ENCIMA del borde derecho de la pista de la carta i.
 * F72.8 · y tampoco va ya como `filter` del abanico: un filtro en un antepasado obliga a rasterizar la pista dentro de
 * una superficie filtrada. Con pistas, el halo es un ELEMENTO propio (`RIVAL_HAND_HALO_SHADOW`) detrás del abanico, y
 * ningún antepasado de la pista lleva filtro, sombra, opacidad ni giro. Sin pistas, cada dorso lleva el suyo, como
 * siempre (ahí las cartas sí se solapan y la sombra las separa).
 */
export const RIVAL_BACK_HALO = "drop-shadow(0 0 8px rgba(255,46,99,0.45)) drop-shadow(0 8px 14px rgba(0,0,0,0.6))";
/** F72.8 · el mismo halo, como sombra de un elemento propio detrás del abanico con pistas. */
export const RIVAL_HAND_HALO_SHADOW = "0 0 14px rgba(255,46,99,0.40), 0 10px 18px rgba(0,0,0,0.55)";

export function RivalHand({ count, hints = [], roles = [], className }: { count: number; hints?: readonly (RivalCardHint | null)[]; roles?: readonly (RoleId | null)[]; className?: string }) {
  if (count <= 0) {
    return (
      <div className={cn("flex min-h-[clamp(20px,2.8vh,32px)] items-center justify-center", className)}>
        <span className="font-display text-[10px] uppercase tracking-[0.24em] text-drl/40">
          Sin cartas
        </span>
      </div>
    );
  }

  const n = Math.min(count, 10);
  // F71 · con pistas los dorsos crecen, casi no se solapan y apenas giran: el dato tiene que leerse.
  const conPistas = hints.length === count && count <= 10;
  const maxAngle = Math.min(4, 20 / n);

  return (
    <div
      className={cn("flex min-h-[clamp(20px,2.8vh,32px)] items-start justify-center", conPistas && "relative isolate", className)}
      style={{ perspective: 900 }}
      aria-label={`El rival tiene ${count} ${count === 1 ? "carta" : "cartas"} ocultas`}
      role={conPistas ? "group" : "img"}
      data-testid="rival-hand"
    >
      {conPistas && (
        <span
          aria-hidden
          data-hand-halo
          className="pointer-events-none absolute inset-x-[-2px] inset-y-[2px] -z-10 rounded-[8px]"
          style={{ boxShadow: RIVAL_HAND_HALO_SHADOW }}
        />
      )}
      {Array.from({ length: n }, (_, i) => {
        const centro = (n - 1) / 2;
        const off = i - centro;
        return (
          <div
            key={i}
            className="shrink-0 origin-top"
            style={{
              marginLeft: i === 0 ? 0 : conPistas ? "clamp(-4px, -0.3vw, -2px)" : "clamp(-16px, -1.1vw, -10px)",
              zIndex: i,
              // Boca abajo y colgando desde arriba: es el otro lado del escenario. F72.8 · con pistas, sin giro y en
              // píxeles enteros: girar o mover a medio píxel re-muestrea la bandera y mezcla sus bordes con el dorso.
              transform: conPistas
                ? `translateY(${Math.round(off * off * 0.12)}px)`
                : `rotate(${-off * maxAngle}deg) translateY(${off * off * 0.3}px)`,
              filter: conPistas ? undefined : RIVAL_BACK_HALO,
            }}
          >
            {conPistas ? (
              <DuelCardBack size="xs" hint={hints[i]} role={roles.length === hints.length ? roles[i] ?? null : null} className="!w-[clamp(26px,min(5.8vh,6.6vw),56px)]" />
            ) : (
              <DuelCardBack size="xs" className="!w-[clamp(24px,3.5vh,42px)]" />
            )}
          </div>
        );
      })}
    </div>
  );
}
