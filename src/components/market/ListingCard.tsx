"use client";

/**
 * MERCADO — UNA CARTA EN VENTA.
 *
 * ══════════════════════════ LAS DOS CIFRAS ══════════════════════════
 *
 * Es lo más importante de esta pieza y lo que el mercado no distinguía:
 *
 *   PRECIO      lo que pide QUIEN VENDE. Es una decisión suya, y es lo que pagas.
 *   REFERENCIA  `instanceValue`: el índice interno del juego para esa carta y esa serie.
 *               No es lo que vale en el mercado ni lo que nadie ha pagado.
 *
 * Escribir «vale 2.500» cuando 2.500 es el precio que ha puesto un vendedor sería mentir. Por
 * eso el precio manda tipográficamente y la referencia va debajo, en pequeño, con su nombre —
 * y con la diferencia dicha en porcentaje cuando se aparta lo suficiente para importar.
 *
 * ══════════════════════════ LA OTRA CORRECCIÓN ══════════════════════════
 *
 * La rejilla anterior declaraba cinco columnas flexibles: la celda medía 262 px y la carta
 * 150, así que el botón de compra salía 112 px más ancho que la carta a la que pertenecía y
 * la ficha se leía como una fila de tabla con una miniatura encima. Aquí el bloque entero
 * mide LO QUE MIDE LA CARTA: precio y botón son su etiqueta, no una barra aparte.
 */
import type { CardDef } from "@/domain/cards/types";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { TrendBadge } from "@/components/market/TrendBadge";
import { computeTrend } from "@/domain/market/history";
import type { PriceRecord } from "@/domain/market/types";
import { formatCredits } from "@/lib/format";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("market");

export interface ListingView {
  id: string;
  cardId: string;
  def: CardDef;
  price: number;
  /** `instanceValue` para esta carta y esta serie. Índice interno, no precio de mercado. */
  reference: number;
  serial?: number;
  /** Historial de precios REAL, si lo hay. Alimenta la tendencia; no se inventa. */
  history?: PriceRecord;
}

export function ListingCard({
  listing, credits, busy, onOpen, onBuy,
}: {
  listing: ListingView;
  credits: number;
  busy: boolean;
  onOpen: () => void;
  onBuy: () => void;
}) {
  useLocale();
  const alcanza = credits >= listing.price;
  /* La diferencia solo se dice cuando es lo bastante grande para cambiar una decisión. */
  const delta = listing.reference > 0
    ? Math.round(((listing.price - listing.reference) / listing.reference) * 100)
    : 0;
  const desviado = Math.abs(delta) >= 10;
  /*
   * La tendencia solo se dibuja cuando hay tendencia. `computeTrend` devuelve «estable»
   * también cuando NO HAY DATOS (menos de cuatro ventas), así que la insignia salía en
   * cincuenta y cuatro fichas seguidas diciendo lo mismo: una marca que está siempre no
   * marca nada. Aquí la ausencia significa «nada que señalar»; la ficha de detalle, que
   * tiene sitio y contexto, sí enseña el estado completo.
   */
  const tendencia = listing.history ? computeTrend(listing.history) : "stable";

  return (
    <article className="flex w-[150px] flex-col gap-2">
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("Ver {id} en venta por {price} créditos", { id: listing.def.id, price: listing.price })}
        className="nx-focus block transition-transform duration-fast motion-safe:hover:-translate-y-1"
      >
        <PlayerCard card={listing.def} size="sm" interactive={false} serial={listing.serial} />
      </button>

      <div className="flex items-end justify-between gap-2">
        <Readout size="sm" label={t("Precio")} value={formatCredits(listing.price)} tone="var(--nx-gold)" />
        {tendencia !== "stable" && <TrendBadge record={listing.history} />}
      </div>

      {/*
        La referencia, dicha por su nombre. Un jugador que ve «2.500» y «referencia 2.150»
        entiende que está pagando por encima; con una sola cifra no puede saberlo.
      */}
      {/*
        Alto reservado: sin él, las fichas cuya desviación merece insignia crecen una línea y
        los botones de compra de una misma fila dejan de estar alineados.
      */}
      <p className="flex min-h-[22px] items-center gap-1.5 text-caption text-ink-faint">
        <span>{t("Ref.")} {formatCredits(listing.reference)}</span>
        {desviado && (
          <Badge tone={delta > 0 ? "warn" : "ok"}>
            {delta > 0 ? `+${delta}%` : `${delta}%`}
          </Badge>
        )}
      </p>

      <NxButton
        variant={alcanza ? "primary" : "secondary"}
        size="md"
        block
        disabled={busy || !alcanza}
        onClick={onBuy}
      >
        {alcanza ? t("Comprar") : t("Sin saldo")}
      </NxButton>
    </article>
  );
}
