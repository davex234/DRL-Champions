"use client";

/**
 * MERCADO — PUBLICAR UNA CARTA.
 *
 * ══════════════════════════ POR QUÉ ESTÁ AQUÍ ══════════════════════════
 *
 * «Mis ventas» decía literalmente *«No tienes cartas en venta. Publícalas desde tu
 * colección.»* — es decir, el mercado no dejaba vender: te mandaba a otra pantalla, a buscar
 * una carta, a abrir su ficha y a encontrar un botón. El sitio donde se vende es el mercado.
 *
 * ══════════════════════════ QUÉ DICE, Y QUÉ NO ══════════════════════════
 *
 * Dice lo que el flujo REAL conoce: qué carta vendes, su valor de referencia, el precio que
 * pides y el mínimo que acepta el motor (25). Y dice lo que ocurre al publicar: la carta sale
 * de tu colección y queda retenida hasta que se venda o la retires.
 *
 * NO dice comisión. El mercado local no cobra ninguna —la retención del 5 % existe solo en el
 * mercado entre jugadores, y ese flujo la muestra donde se aplica—. Inventar aquí una
 * comisión que nadie cobra sería exactamente igual de falso que ocultar una que sí se cobra.
 *
 * La regla la sigue poniendo `useMarketStore.listForSale`: esta pieza solo presenta.
 */
import { useEffect, useMemo, useState } from "react";
import type { CardDef } from "@/domain/cards/types";
import { Plate, Recessed } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { formatCredits, cn } from "@/lib/format";

/** Precio mínimo que acepta el motor de mercado. No es una decisión de esta pantalla. */
export const MIN_PRICE = 25;

export interface SellableCard {
  uid: string;
  def: CardDef;
  serial?: number;
  /** `instanceValue`: índice interno para esa carta y esa serie. */
  reference: number;
  /** Bloqueada por el jugador: no se puede vender ni forjar. */
  locked: boolean;
}

export function SellPanel({
  cards, busy, onPublish,
}: {
  cards: SellableCard[];
  busy: boolean;
  onPublish: (uid: string, price: number) => void;
}) {
  const vendibles = useMemo(() => cards.filter((c) => !c.locked), [cards]);
  const [uid, setUid] = useState<string | null>(vendibles[0]?.uid ?? null);
  const elegida = vendibles.find((c) => c.uid === uid) ?? null;
  const [price, setPrice] = useState<number>(elegida?.reference ?? MIN_PRICE);

  /*
   * Al PUBLICAR, la carta elegida sale de la colección y su uid deja de existir. Sin esto la
   * selección se quedaba apuntando a una carta que ya no está: el panel perdía el precio y
   * pintaba «el precio mínimo es 25» —una queja sobre nada— justo encima del aviso de que la
   * publicación había ido bien. Se pasa a la siguiente carta vendible.
   */
  useEffect(() => {
    if (vendibles.length === 0) { if (uid !== null) setUid(null); return; }
    if (!uid || !vendibles.some((c) => c.uid === uid)) setUid(vendibles[0].uid);
  }, [vendibles, uid]);

  /* Al cambiar de carta, el precio parte de SU referencia: es el ancla honesta. */
  useEffect(() => {
    if (elegida) setPrice(elegida.reference);
  }, [elegida?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (cards.length === 0) {
    return (
      <Plate className="p-6 text-center">
        <SectionTitle as="p">No tienes cartas que vender</SectionTitle>
        <p className="mx-auto max-w-[46ch] text-body text-ink-muted">
          Cuando abras sobres y consigas repetidas, podrás publicarlas aquí.
        </p>
      </Plate>
    );
  }

  const valido = Number.isFinite(price) && price >= MIN_PRICE && elegida !== null;
  const delta = elegida && elegida.reference > 0
    ? Math.round(((price - elegida.reference) / elegida.reference) * 100)
    : 0;

  return (
    <Plate className="p-4 sm:p-5">
      <SectionTitle as="h3">Publicar una carta</SectionTitle>

      {/*
        Las dos columnas se quedan JUNTAS y a la izquierda. Con `1fr` para la primera, el
        cuadro de «Al publicar» se iba al borde derecho de una pantalla de 1440 y quedaba a
        medio metro de la carta que estás vendiendo: dos cosas relacionadas, lejísimos.
      */}
      <div className="grid gap-5 lg:[grid-template-columns:minmax(320px,620px)_210px] lg:items-start lg:justify-start">
        <div className="min-w-0">
          {/* ── Qué vendes ── */}
          <p className="mb-2 font-display text-label uppercase tracking-wide2 text-ink-faint">Tu carta</p>
          <div className="nx-scroll flex gap-2 overflow-x-auto pb-2">
            {cards.map((c) => {
              const activa = c.uid === uid;
              return (
                <button
                  key={c.uid}
                  type="button"
                  disabled={c.locked}
                  onClick={() => setUid(c.uid)}
                  aria-current={activa ? "true" : undefined}
                  aria-label={`${c.def.id}${c.locked ? " (bloqueada)" : ""}`}
                  className={cn(
                    "nx-focus nx-clip-sm relative shrink-0 p-1 transition-colors duration-fast",
                    activa ? "bg-white/[0.10]" : "hover:bg-white/[0.05]",
                    c.locked && "cursor-not-allowed opacity-40",
                  )}
                >
                  {/*
                    La carta se dibuja a su tamaño real (150 px) y se ESCALA dentro de una caja
                    de 96×134. Darle una caja más estrecha sin escalarla la recortaba: es el
                    mismo fallo que la Fase 6 corrigió en el resumen del sobre.
                  */}
                  <span className="pointer-events-none relative block h-[134px] w-[96px] overflow-hidden">
                    <span className="absolute left-0 top-0 origin-top-left scale-[0.64]">
                      <PlayerCard card={c.def} size="sm" interactive={false} serial={c.serial} />
                    </span>
                  </span>
                  {c.locked && (
                    <span className="absolute inset-x-1 bottom-1">
                      <Badge tone="warn">Bloqueada</Badge>
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── A qué precio ── */}
          {elegida && (
            <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
              <label className="block">
                <span className="mb-1 block font-display text-label uppercase tracking-wide2 text-ink-faint">
                  Precio de venta
                </span>
                <Recessed>
                  <input
                    type="number"
                    min={MIN_PRICE}
                    step={25}
                    value={Number.isFinite(price) ? price : ""}
                    onChange={(e) => setPrice(Math.round(Number(e.target.value)))}
                    aria-label="Precio de venta en créditos"
                    className="nx-focus min-h-[44px] w-[140px] bg-transparent px-3 text-body text-white focus:outline-none"
                  />
                </Recessed>
              </label>

              <Readout
                size="sm"
                label="Referencia"
                value={formatCredits(elegida.reference)}
                tone="var(--nx-ink-secondary)"
              />

              {Math.abs(delta) >= 10 && (
                <Badge tone={delta > 0 ? "warn" : "ok"}>
                  {delta > 0 ? `+${delta}% sobre la referencia` : `${delta}% bajo la referencia`}
                </Badge>
              )}
            </div>
          )}

          {/* La queja es SOBRE UN PRECIO: sin carta elegida no hay precio del que quejarse. */}
          {elegida && !valido && (
            <p className="mt-2 text-caption text-warn">
              El precio mínimo es <span className="nx-readout">{MIN_PRICE}</span> créditos.
            </p>
          )}
        </div>

        {/* ── Qué va a pasar ── */}
        <Recessed className="p-3.5">
          <p className="font-display text-label uppercase tracking-wide2 text-ink-faint">Al publicar</p>
          <ul className="mt-2 space-y-1.5 text-caption leading-snug text-ink-muted">
            <li>La carta sale de tu colección y queda retenida.</li>
            <li>Puedes retirarla cuando quieras desde «Mis anuncios».</li>
            <li>Cuando se venda, recibes el precio en créditos.</li>
          </ul>
          <NxButton
            variant="primary"
            size="lg"
            block
            className="mt-3.5"
            disabled={!valido || busy}
            onClick={() => elegida && onPublish(elegida.uid, price)}
          >
            {busy ? "Publicando…" : "Publicar"}
          </NxButton>
        </Recessed>
      </div>
    </Plate>
  );
}
