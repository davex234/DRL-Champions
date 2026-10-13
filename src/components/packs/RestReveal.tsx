"use client";

/**
 * F81 · EL RESTO DEL SOBRE — las demás cartas (sin la hero), en el orden de presentación (OVR descendente; empates en el
 * orden del servidor), girando en cascada rápida. PRESENTACIÓN PURA: las cartas ya son del jugador.
 *
 * Avanza solo al resumen cuando termina la cascada (`restRevealMs`); un toque o «Ver resumen» lo adelanta. El botón no
 * existe hasta que termina la cascada: un doble clic en CONTINUAR no encadena «resto → resumen» sin ver las cartas.
 */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { RevealItem } from "@/domain/packs/reveal";
import { REST_STAGGER_MS, REST_STAGGER_REDUCED_MS, restRevealMs } from "@/domain/packs/reveal";
import { getVariant } from "@/domain/cards/variants";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardVisual } from "@/components/cards/CardVisual";
import { NxButton } from "@/components/ui/NxButton";
import { CardBack } from "./CardBack";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("packs");

const W = 140; // `PlayerCard` sm se escala a esta anchura dentro de la cuadrícula

export function RestReveal({ items, reduced, onDone, onAdvance }: {
  items: readonly RevealItem[];
  reduced: boolean;
  onDone: () => void;
  onAdvance: () => void;
}) {
  useLocale();
  const step = reduced ? REST_STAGGER_REDUCED_MS : REST_STAGGER_MS;
  const total = restRevealMs(items.length, reduced);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const r = setTimeout(() => setReady(true), Math.max(0, total - 350));
    const t = setTimeout(onDone, total + 900);
    return () => { clearTimeout(r); clearTimeout(t); };
  }, [total, onDone]);

  return (
    <div className="absolute inset-0 z-floating flex flex-col items-center justify-center overflow-y-auto px-4 py-16" onClick={onAdvance} data-testid="rest-reveal" data-count={items.length}>
      <p className="nx-label text-center">{tr("Y además")}</p>
      <ul className="mt-3 flex max-w-4xl flex-wrap justify-center gap-3 sm:gap-4" data-testid="rest-cards">
        {items.map((it, k) => {
          const accent = getVariant(it.card.variantId).palette.primary;
          const delay = (k * step) / 1000;
          return (
            <li key={it.uid} className="flex flex-col items-center" style={{ width: W }} data-testid="rest-card" data-uid={it.uid} data-ovr={it.card.ovr} data-status={it.status}>
              <div className="relative" style={{ width: W, height: (W * 7) / 5, perspective: 900 }}>
                {reduced ? (
                  /* Movimiento reducido: sin giro; la cara aparece con un fundido corto, en la misma cascada. */
                  <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay, duration: 0.26 }}>
                    <CardVisual uid={it.uid} alt={tr("Carta de {cardId}", { cardId: it.cardId })} chamfer="10px" className="w-full">
                      <PlayerCard card={it.card} size="sm" serial={it.serial ?? undefined} interactive={false} className="!w-full" />
                    </CardVisual>
                  </motion.div>
                ) : (
                  <motion.div className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}
                    initial={{ rotateY: 0, opacity: 0, y: 18 }} animate={{ rotateY: 180, opacity: 1, y: 0 }}
                    transition={{ delay, duration: 0.45, ease: "easeOut" }}>
                    <CardBack accent={accent} chargeColor={accent} charged={1} pulse={false} className="absolute inset-0 w-full" style={{ backfaceVisibility: "hidden" }} />
                    <div className="absolute inset-0" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
                      <CardVisual uid={it.uid} alt={tr("Carta de {cardId}", { cardId: it.cardId })} chamfer="10px" className="w-full">
                        <PlayerCard card={it.card} size="sm" serial={it.serial ?? undefined} interactive={false} className="!w-full" />
                      </CardVisual>
                    </div>
                  </motion.div>
                )}
              </div>
              <p className="mt-1.5 w-full truncate text-center font-display text-caption font-bold uppercase tracking-wide text-white">
                {it.player?.nick ?? it.cardId}<span className="nx-readout ml-1.5 text-ink-secondary">{it.card.ovr}</span>
              </p>
              {it.status === "duplicate" && <p className="font-display text-label uppercase tracking-wide2 text-ink-faint">{tr("Duplicada · ×")}{it.copiesAfter}</p>}
              {it.status === "new" && <p className="font-display text-label uppercase tracking-wide2 text-[#3fc07a]">{it.newVariant ? tr("Nueva variante") : tr("Nueva")}</p>}
            </li>
          );
        })}
      </ul>
      <div className="mt-6 min-h-[56px]" onClick={(e) => e.stopPropagation()}>
        {ready && (
          <NxButton variant="primary" size="lg" onClick={onAdvance} data-testid="rest-continue" className="!min-h-[52px]">
            {tr("Ver resumen")}
          </NxButton>
        )}
      </div>
    </div>
  );
}
