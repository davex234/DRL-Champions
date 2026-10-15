"use client";

/**
 * F81 · LA HERO CARD — tensión → giro → momento para mirarla. PRESENTACIÓN PURA.
 *
 * Recibe la hero YA ELEGIDA (`domain/packs/reveal · selectHero`: mayor OVR del catálogo; empate → una sola, fija para
 * esta apertura) del resultado PERSISTIDO. No sortea, no ordena el sobre, no toca inventario: dibuja.
 *
 *   · `buildup`   la sala en luz NEUTRA (la pinta `RevealAtmosphere`), el dorso se carga, líneas de energía convergen
 *                 (límite fijo de nodos). Rarezas altas: un temblor mínimo. Con movimiento reducido: solo luz.
 *   · `hero`      el giro (3D; reducido: fundido): en ese instante la sala toma el color de la RAREZA de esta carta y el
 *                 aterrizaje (`RevealSpotlight`) va proporcionado a ella.
 *   · `hero_hold` la hero quieta y legible, con su ficha y CONTINUAR. Ningún temporizador la quita: decide el jugador.
 *                 Si se vuelve aquí desde el resto, la carta ya está boca arriba (no gira otra vez).
 *
 * 2026-10-15: la sala y los efectos salen del AMBIENTE de la carta (`domain/packs/atmosphere`), no del color de su
 * edición; sin destello a pantalla completa (la cúspide florece, no deslumbra).
 */
import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { motion } from "framer-motion";
import type { OpenedResult } from "@/store/useGameStore";
import { HERO_FLIP_MS, HERO_FLIP_REDUCED_MS, buildupMs, type RevealItem } from "@/domain/packs/reveal";
import { atmosphereForCard } from "@/domain/packs/atmosphere";
import { getVariant } from "@/domain/cards/variants";
import { NxButton } from "@/components/ui/NxButton";
import { playCue, playReveal } from "@/lib/sound";
import { buzz } from "@/lib/haptics";
import { RevealSpotlight, SPOT_CARD_H, SPOT_CARD_W, spotlightScale, useSpotlightScale } from "./RevealSpotlight";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("packs");

export type HeroStage = "buildup" | "hero" | "hero_hold";

/** Tope de líneas de energía (nodos DOM): suficiente para leerse como «converge», nada más. */
export const ENERGY_STREAKS = 12;

/** Escala de la hero para que carta + ficha + botón quepan SIEMPRE en el viewport (sin scroll, sin cortes). */
export const heroScale = (viewportW: number, viewportH: number): number => spotlightScale(viewportW, viewportH);
export { SPOT_CARD_W as HERO_CARD_W, SPOT_CARD_H as HERO_CARD_H };

export function HeroReveal({
  stage, item, result, total, reduced, onBuildupDone, onHeroShown, onContinue, onAdvance, continueRef,
}: {
  stage: HeroStage;
  item: RevealItem;
  result: OpenedResult;
  /** Cartas del sobre (1 = la hero es el sobre entero: CONTINUAR lleva al resumen). */
  total: number;
  reduced: boolean;
  onBuildupDone: () => void;
  onHeroShown: () => void;
  onContinue: () => void;
  /** Toque en la escena: avanza un paso (nunca se salta la hero). */
  onAdvance: () => void;
  continueRef?: Ref<HTMLButtonElement>;
}) {
  useLocale();
  const variant = getVariant(item.card.variantId);
  const atmosphere = atmosphereForCard(item.card);
  const high = atmosphere.tier >= 2;
  const maxMoment = atmosphere.tier >= 3 || item.prestige?.tier === "NUMBER_ONE";
  const scale = useSpotlightScale();
  const revealed = stage !== "buildup";
  // Montada ya quieta (vuelta desde el resto): sin giro, sin efectos, sin sonido.
  const fresh = useRef(stage !== "hero_hold").current;
  const buildMs = buildupMs(item.rarity, reduced);
  const flipMs = reduced ? HERO_FLIP_REDUCED_MS : HERO_FLIP_MS;
  const sounded = useRef(!fresh);

  /* Los relojes solo AVISAN; quien cambia de estado es la máquina (`revealReducer`). */
  useEffect(() => {
    if (stage !== "buildup") return;
    const t = setTimeout(onBuildupDone, buildMs);
    return () => clearTimeout(t);
  }, [stage, buildMs, onBuildupDone]);
  useEffect(() => {
    if (stage !== "hero") return;
    const t = setTimeout(onHeroShown, flipMs);
    return () => clearTimeout(t);
  }, [stage, flipMs, onHeroShown]);
  useEffect(() => {
    if (!revealed || sounded.current) return;
    sounded.current = true;
    playReveal(variant?.rank ?? 1);
    if (maxMoment) { playCue("round_win"); buzz("match"); } else if (high) buzz("point");
  }, [revealed, variant, maxMoment, high]);

  /* Carga del dorso en 6 pasos (indicador de progreso, no animación por fotograma). */
  const [charge, setCharge] = useState(0);
  useEffect(() => {
    if (stage !== "buildup") return;
    const ids = Array.from({ length: 6 }, (_, k) => setTimeout(() => setCharge((k + 1) / 6), (buildMs / 6) * (k + 1)));
    return () => ids.forEach(clearTimeout);
  }, [stage, buildMs]);

  const streaks = useMemo(() => Array.from({ length: ENERGY_STREAKS }, (_, i) => ({ id: i, angle: (360 / ENERGY_STREAKS) * i + (i % 3) * 7, delay: (i % 4) * 0.06 })), []);
  const player = item.player;
  const neutral = "#c9d3ea";

  return (
    <div
      className="absolute inset-0 z-floating flex flex-col items-center justify-center overflow-hidden px-4"
      onClick={onAdvance}
      data-testid="hero-reveal"
      data-stage={stage}
      data-uid={item.uid}
      data-card-id={item.cardId}
      data-ovr={item.card.ovr}
      data-rarity={item.rarity}
      data-atmosphere={revealed ? atmosphere.key : "neutral"}
      data-reduced={String(reduced)}
      role="group"
      aria-roledescription={tr("carta protagonista")}
      aria-label={revealed ? tr("{v}, OVR {ovr}", { v: player?.nick ?? item.cardId, ovr: item.card.ovr }) : tr("Revelando la mejor carta del sobre")}
    >
      <p className="sr-only" aria-live="polite" data-testid="hero-announcement">
        {stage === "buildup" ? tr("Revelando la mejor carta del sobre.") : tr("{v}. {rarityLabel}. OVR {ovr}.", { v: player?.nick ?? item.cardId, rarityLabel: td(item.rarityLabel), ovr: item.card.ovr })}
      </p>

      {/* TENSIÓN · líneas de energía NEUTRAS que convergen hacia la carta (12 nodos, una sola pasada). Reducido: no. */}
      {stage === "buildup" && !reduced && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center" data-testid="hero-energy">
          {streaks.map((s) => (
            <motion.span
              key={s.id}
              className="absolute h-[2px] w-[46vmax] origin-left"
              style={{ left: "50%", top: "44%", rotate: s.angle, background: `linear-gradient(90deg, transparent, ${neutral}cc 70%, transparent)` }}
              initial={{ scaleX: 1, x: "18vmax", opacity: 0 }}
              animate={{ scaleX: 0.15, x: "2vmax", opacity: [0, 0.9, 0] }}
              transition={{ duration: buildMs / 1000, delay: s.delay, ease: "easeIn" }}
            />
          ))}
          <motion.span
            className="absolute rounded-full border"
            style={{ borderColor: `${neutral}aa`, width: 360, height: 360, top: "44%", left: "50%", x: "-50%", y: "-50%" }}
            initial={{ scale: 1.9, opacity: 0 }}
            animate={{ scale: 0.95, opacity: [0, 0.8, 0.2] }}
            transition={{ duration: buildMs / 1000, ease: "easeIn" }}
          />
        </div>
      )}

      <RevealSpotlight
        ids={{ box: "hero-card-box", info: "hero-info" }}
        item={item}
        card={result.card}
        uid={result.uid}
        serial={result.serial}
        atmosphere={atmosphere}
        revealed={revealed}
        fresh={fresh}
        reduced={reduced}
        flipMs={flipMs}
        charge={charge}
        accent={atmosphere.glow}
        scale={scale}
        header={stage === "buildup" ? <p className="font-display text-label font-bold uppercase tracking-wide2 text-white/75" data-testid="hero-buildup-copy">{tr("La mejor carta del sobre…")}</p> : null}
      >
        {stage === "hero_hold" && (
          <motion.div className="mt-2 flex w-full flex-col items-center" initial={fresh ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
            <NxButton ref={continueRef} variant="primary" size="lg" onClick={(e) => { e.stopPropagation(); onContinue(); }} data-testid="hero-continue" className="!min-h-[56px] w-full max-w-[320px]">
              {total > 1 ? tr("Continuar · {v} más", { v: total - 1 }) : tr("Ver resumen")}
            </NxButton>
          </motion.div>
        )}
      </RevealSpotlight>
    </div>
  );
}
