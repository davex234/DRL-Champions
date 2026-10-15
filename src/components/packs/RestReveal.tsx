"use client";

/**
 * EL RESTO DEL SOBRE — CARTA A CARTA (2026-10-15; antes, F81, una cascada de miniaturas). PRESENTACIÓN PURA: las cartas
 * ya son del jugador. Orden = `plan.order` sin la hero (OVR descendente; empates en el orden del servidor), nunca otro.
 *
 * Cada carta tiene su propio momento: la sala vuelve a luz NEUTRA mientras el dorso se carga (`revealPrepMs`, más largo
 * cuanto más alta la clase), la carta gira y la sala toma el color de SU rareza (`RevealAtmosphere`, en la pantalla
 * madre). La posición la lleva la máquina (`revealReducer`: `restIndex`, `restShown`), así que un toque, Enter o →
 * avanzan UN paso; ← o «Anterior» vuelven a una carta ya vista (boca arriba, sin girar otra vez) y, desde la primera, a
 * la hero. Los puntos de arriba solo colorean cartas YA vistas: no adelantan la rareza de ninguna.
 */
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import type { RevealItem } from "@/domain/packs/reveal";
import { CARD_FLIP_MS, CARD_FLIP_REDUCED_MS, NEUTRAL_ATMOSPHERE, atmosphereForCard, revealPrepMs } from "@/domain/packs/atmosphere";
import { getVariant } from "@/domain/cards/variants";
import { NxButton } from "@/components/ui/NxButton";
import { playReveal } from "@/lib/sound";
import { buzz } from "@/lib/haptics";
import { RevealSpotlight, useSpotlightScale } from "./RevealSpotlight";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("packs");

/** Ficha + botones + puntos de posición. */
const REST_RESERVED_H = 330;

export function RestReveal({ items, index, shown, reduced, onShown, onNext, onBack }: {
  items: readonly RevealItem[];
  /** Carta en escena (0…n-1) y si ya giró: los lleva `revealReducer`. */
  index: number;
  shown: boolean;
  reduced: boolean;
  onShown: () => void;
  /** Un paso adelante (girar ya / la siguiente / el resumen). */
  onNext: () => void;
  /** Un paso atrás (la anterior ya vista; desde la primera, la hero). */
  onBack: () => void;
}) {
  useLocale();
  const scale = useSpotlightScale(REST_RESERVED_H);
  const item = items[Math.max(0, Math.min(items.length - 1, index))];
  if (!item) return null;
  return (
    <div className="absolute inset-0 z-floating flex flex-col items-center justify-center overflow-hidden px-4 pt-14" onClick={onNext}
      data-testid="rest-reveal" data-count={items.length} data-index={index} data-shown={String(shown)}>
      <RestPips items={items} index={index} shown={shown} />
      <RestCard key={item.uid} item={item} index={index} total={items.length} shown={shown} reduced={reduced} scale={scale} onShown={onShown} onNext={onNext} onBack={onBack} />
    </div>
  );
}

/** Posición en el resto. Una carta aún sin ver es un punto neutro: los puntos nunca anticipan una rareza. */
function RestPips({ items, index, shown }: { items: readonly RevealItem[]; index: number; shown: boolean }) {
  return (
    <ol className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-1.5" style={{ marginTop: "env(safe-area-inset-top)" }} aria-hidden data-testid="rest-pips">
      {items.map((it, k) => {
        const seen = k < index || (k === index && shown);
        const color = seen ? atmosphereForCard(it.card).glow : NEUTRAL_ATMOSPHERE.glow;
        return (
          <li key={it.uid} className="h-1.5 rounded-full transition-all duration-300"
            style={{ width: k === index ? 22 : 8, background: color, opacity: seen || k === index ? 1 : 0.35, boxShadow: seen ? `0 0 8px ${color}` : undefined }}
            data-seen={String(seen)} />
        );
      })}
    </ol>
  );
}

function RestCard({ item, index, total, shown, reduced, scale, onShown, onNext, onBack }: {
  item: RevealItem; index: number; total: number; shown: boolean; reduced: boolean; scale: number;
  onShown: () => void; onNext: () => void; onBack: () => void;
}) {
  const atmosphere = atmosphereForCard(item.card);
  // Montada boca abajo = se revela AHORA; montada boca arriba = se ha vuelto a ella.
  const fresh = useRef(!shown).current;
  const flipMs = reduced ? CARD_FLIP_REDUCED_MS : CARD_FLIP_MS;
  const prepMs = revealPrepMs(atmosphere.tier, reduced);

  /* El reloj solo AVISA: el giro lo decide la máquina (`REST_SHOWN`). Un toque antes lo adelanta (`ADVANCE`). */
  useEffect(() => {
    if (shown) return;
    const t = setTimeout(onShown, prepMs);
    return () => clearTimeout(t);
  }, [shown, prepMs, onShown]);
  useEffect(() => {
    if (!shown || !fresh) return;
    playReveal(getVariant(item.card.variantId)?.rank ?? 1);
    if (atmosphere.tier >= 2) buzz("point");
    // Solo al girar ESTA carta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  const last = index + 1 >= total;
  return (
    <div className="flex w-full flex-col items-center" data-testid="rest-card" data-uid={item.uid} data-card-id={item.cardId} data-ovr={item.card.ovr}
      data-status={item.status} data-rarity={item.rarity} data-atmosphere={shown ? atmosphere.key : "neutral"} data-shown={String(shown)}>
      <p className="sr-only" aria-live="polite">{shown ? item.announcement : ""}</p>
      <RevealSpotlight
        item={item}
        card={item.card}
        uid={item.uid}
        serial={item.serial}
        atmosphere={atmosphere}
        revealed={shown}
        fresh={fresh}
        reduced={reduced}
        flipMs={flipMs}
        charge={shown ? 1 : 0.6}
        accent={atmosphere.glow}
        scale={scale}
        header={<p className="font-display text-label font-bold uppercase tracking-wide2 text-white/70" data-testid="rest-prep">{tr("Carta {v} de {total}", { v: index + 2, total: total + 1 })}</p>}
      >
        <motion.div className="mt-2 flex w-full max-w-[360px] items-center justify-center gap-2" initial={false} animate={{ opacity: 1 }}>
          <NxButton variant="secondary" size="lg" onClick={(e) => { e.stopPropagation(); onBack(); }} data-testid="rest-back" aria-label={tr("Carta anterior")}
            // Sala clara (Icon): el secundario translúcido de siempre es texto blanco sobre marfil → fondo oscuro legible.
            className={shown && atmosphere.tone === "light" ? "!min-h-[52px] flex-1 !bg-[#1a1408]/85 !text-white" : "!min-h-[52px] flex-1"}>
            {tr("Anterior")}
          </NxButton>
          <NxButton variant="primary" size="lg" onClick={(e) => { e.stopPropagation(); onNext(); }} data-testid="rest-continue" data-action={!shown ? "reveal" : last ? "summary" : "next"} className="!min-h-[52px] flex-[1.4]">
            {!shown ? tr("Revelar") : last ? tr("Ver resumen") : tr("Siguiente · {v} más", { v: total - index - 1 })}
          </NxButton>
        </motion.div>
      </RevealSpotlight>
    </div>
  );
}
