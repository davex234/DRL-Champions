"use client";

/**
 * F81 · LA HERO CARD — tensión → giro → momento para mirarla. PRESENTACIÓN PURA.
 *
 * Recibe la hero YA ELEGIDA (`domain/packs/reveal · selectHero`: mayor OVR del catálogo; empate → una sola, fija para
 * esta apertura) del resultado PERSISTIDO. No sortea, no ordena el sobre, no toca inventario: dibuja.
 *
 *   · `buildup`   la energía del sobre se concentra en UNA carta boca abajo: el dorso se carga con el color REAL de la
 *                 hero, la sala se apaga, líneas de energía convergen (límite fijo de nodos) y un barrido de luz cruza
 *                 el dorso. Rarezas altas: un temblor mínimo. Con movimiento reducido: solo luz (sin zoom ni temblor).
 *   · `hero`      el giro (3D; reducido: fundido) con aterrizaje, onda, esquirlas y estallido acotados a la rareza.
 *   · `hero_hold` la hero quieta y legible, con su ficha (OVR, jugador, rol, equipo, edición, rareza, serial, estado)
 *                 y CONTINUAR. Ningún temporizador la quita: decide el jugador.
 *
 * La carta es `CardVisual` → `CardArt`/`PlayerCard`: el asset ES la carta, sin marco nuevo alrededor.
 */
import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { motion } from "framer-motion";
import type { OpenedResult } from "@/store/useGameStore";
import { HERO_FLIP_MS, HERO_FLIP_REDUCED_MS, buildupMs, type RevealItem } from "@/domain/packs/reveal";
import { getVariant } from "@/domain/cards/variants";
import { canonicalCardTeam } from "@/data/teamIdentities";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardVisual } from "@/components/cards/CardVisual";
import { NxButton } from "@/components/ui/NxButton";
import { EASE } from "@/design/motion";
import { playCue, playReveal } from "@/lib/sound";
import { buzz } from "@/lib/haptics";
import { CardBack } from "./CardBack";
import { ParticleBurst } from "./Particles";
import { MAX_BURST, rarityCeremony } from "./ceremony";

export type HeroStage = "buildup" | "hero" | "hero_hold";

/** Tope de líneas de energía (nodos DOM): suficiente para leerse como «converge», nada más. */
export const ENERGY_STREAKS = 12;
const CARD_W = 300; // `PlayerCard` lg
const CARD_H = (CARD_W * 7) / 5;

/** Escala de la hero para que carta + ficha + botón quepan SIEMPRE en el viewport (sin scroll, sin cortes). */
export function heroScale(viewportW: number, viewportH: number): number {
  const byW = (viewportW - 32) / CARD_W;
  const byH = (viewportH - 300) / CARD_H; // ficha + CONTINUAR + márgenes ≈ 300 px
  return Math.max(0.5, Math.min(1, byW, byH));
}

function useHeroScale(): number {
  const [s, setS] = useState(0.78);
  useEffect(() => {
    const m = () => setS(heroScale(window.innerWidth, window.innerHeight));
    m();
    window.addEventListener("resize", m);
    return () => window.removeEventListener("resize", m);
  }, []);
  return s;
}

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
  const variant = getVariant(item.card.variantId);
  const accent = variant.palette.primary;
  const spec = rarityCeremony(item.rarity);
  const high = item.rarity === "epic" || item.rarity === "legendary";
  const maxMoment = item.rarity === "legendary" || item.prestige?.tier === "NUMBER_ONE";
  const scale = useHeroScale();
  const revealed = stage !== "buildup";
  const buildMs = buildupMs(item.rarity, reduced);
  const flipMs = reduced ? HERO_FLIP_REDUCED_MS : HERO_FLIP_MS;
  const sounded = useRef(false);

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
    playReveal(variant.rank);
    if (maxMoment) { playCue("round_win"); buzz("match"); } else if (high) buzz("point");
  }, [revealed, variant.rank, maxMoment, high]);

  /* Carga del dorso en 6 pasos (indicador de progreso, no animación por fotograma). */
  const [charge, setCharge] = useState(0);
  useEffect(() => {
    if (stage !== "buildup") return;
    const ids = Array.from({ length: 6 }, (_, k) => setTimeout(() => setCharge((k + 1) / 6), (buildMs / 6) * (k + 1)));
    return () => ids.forEach(clearTimeout);
  }, [stage, buildMs]);

  const streaks = useMemo(() => Array.from({ length: ENERGY_STREAKS }, (_, i) => ({ id: i, angle: (360 / ENERGY_STREAKS) * i + (i % 3) * 7, delay: (i % 4) * 0.06 })), []);
  const shards = useMemo(() => Array.from({ length: spec.shards }, (_, i) => ({ id: i, x: (i / Math.max(1, spec.shards - 1)) * 100 - 50, delay: 0.05 + (i % 5) * 0.07, size: 7 + ((i * 13) % 11), drift: 140 + ((i * 37) % 120) })), [spec.shards]);
  const player = item.player;
  const team = player ? canonicalCardTeam(item.card, player).label : null;

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
      data-reduced={String(reduced)}
      role="group"
      aria-roledescription="carta protagonista"
      aria-label={revealed ? `${player?.nick ?? item.cardId}, OVR ${item.card.ovr}` : "Revelando la mejor carta del sobre"}
    >
      <p className="sr-only" aria-live="polite" data-testid="hero-announcement">
        {stage === "buildup" ? "Revelando la mejor carta del sobre." : `${player?.nick ?? item.cardId}. ${item.rarityLabel}. OVR ${item.card.ovr}.`}
      </p>

      {/* LA SALA: se apaga en la tensión y se tiñe del color REAL de la hero (luz, no movimiento: también reducido). */}
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 bg-black" initial={{ opacity: 0 }} animate={{ opacity: revealed ? 0.35 : Math.min(0.75, 0.35 + spec.dim) }} transition={{ duration: reduced ? 0.3 : 0.6 }} />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(circle at 50% 44%, ${accent}, transparent 62%)` }}
        initial={{ opacity: 0 }}
        animate={{ opacity: revealed ? 0.38 : 0.12 + charge * 0.22 }}
        transition={{ duration: reduced ? 0.35 : 0.5 }}
      />

      {/* TENSIÓN · líneas de energía que convergen hacia la carta (12 nodos, una sola pasada). Reducido: no. */}
      {stage === "buildup" && !reduced && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center" data-testid="hero-energy">
          {streaks.map((s) => (
            <motion.span
              key={s.id}
              className="absolute h-[2px] w-[46vmax] origin-left"
              style={{ left: "50%", top: "44%", rotate: s.angle, background: `linear-gradient(90deg, transparent, ${accent}cc 70%, transparent)` }}
              initial={{ scaleX: 1, x: "18vmax", opacity: 0 }}
              animate={{ scaleX: 0.15, x: "2vmax", opacity: [0, 0.9, 0] }}
              transition={{ duration: buildMs / 1000, delay: s.delay, ease: "easeIn" }}
            />
          ))}
          <motion.span
            className="absolute rounded-full border"
            style={{ borderColor: `${accent}aa`, width: 360, height: 360, top: "44%", left: "50%", x: "-50%", y: "-50%" }}
            initial={{ scale: 1.9, opacity: 0 }}
            animate={{ scale: 0.95, opacity: [0, 0.8, 0.2] }}
            transition={{ duration: buildMs / 1000, ease: "easeIn" }}
          />
        </div>
      )}

      {/* ATERRIZAJE · onda única, esquirlas y estallido acotados a la rareza REAL. Reducido: halo fijo. */}
      {revealed && !reduced && spec.ring && (
        <motion.span aria-hidden className="pointer-events-none absolute rounded-full border-2" style={{ borderColor: accent, width: 300, height: 300, top: "44%", left: "50%", x: "-50%", y: "-50%" }}
          initial={{ scale: 0.4, opacity: 0.9 }} animate={{ scale: 3.2, opacity: 0 }} transition={{ duration: 1.1, ease: "easeOut" }} />
      )}
      {revealed && !reduced && maxMoment && (
        <motion.span aria-hidden data-testid="hero-max-flash" className="pointer-events-none absolute h-[92vmin] w-[92vmin] rounded-full"
          style={{ top: "44%", left: "50%", x: "-50%", y: "-50%", background: "radial-gradient(closest-side, rgba(255,240,200,0.9), rgba(255,211,92,0.5) 35%, transparent 72%)" }}
          initial={{ opacity: 0, scale: 0.35 }} animate={{ opacity: [0, 0.85, 0], scale: [0.35, 1, 1.2] }} transition={{ duration: 0.7, times: [0, 0.25, 1], ease: "easeOut" }} />
      )}
      {revealed && reduced && (
        <motion.span aria-hidden data-testid="hero-still-glow" className="pointer-events-none absolute h-[78vmin] w-[78vmin] rounded-full"
          style={{ top: "44%", left: "50%", x: "-50%", y: "-50%", background: `radial-gradient(closest-side, ${maxMoment ? "rgba(255,211,92,0.42)" : `${accent}66`}, transparent 72%)` }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} />
      )}
      {revealed && !reduced && shards.map((s) => (
        <motion.span key={s.id} aria-hidden className="pointer-events-none absolute" style={{ top: "50%", left: "50%", width: s.size, height: s.size * 2.1, background: accent, clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }}
          initial={{ x: s.x * 2.4, y: 120, opacity: 0 }} animate={{ y: -s.drift, opacity: [0, 0.95, 0], rotate: s.x > 0 ? 28 : -28 }} transition={{ duration: 1.4, delay: s.delay, ease: "easeOut" }} />
      ))}
      {revealed && !reduced && spec.burst > 0 && <ParticleBurst color={accent} big={spec.burst > 30} count={Math.min(spec.burst, MAX_BURST)} />}

      {/* LA CARTA · dibujada a 300 px y ESCALADA al viewport (transform: no ocupa espacio, no provoca scroll). */}
      <div className="relative grid shrink-0 place-items-center" style={{ width: CARD_W * scale, height: CARD_H * scale }} data-testid="hero-card-box">
        <div style={{ transform: `scale(${scale})`, transformOrigin: "center" }} className="relative">
          <motion.div
            className="relative"
            style={{ transformStyle: "preserve-3d", transformPerspective: 1200, width: CARD_W }}
            initial={{ rotateY: 0, scale: reduced ? 1 : 0.86, opacity: 0, x: 0 }}
            animate={
              !revealed
                ? reduced
                  ? { rotateY: 0, scale: 1, opacity: 1 }
                  : { rotateY: 0, scale: 1, opacity: 1, x: high ? [0, -2, 2, -1.5, 1.5, 0] : 0 }
                : reduced
                  ? { rotateY: 0, scale: 1, opacity: 1 }
                  : { rotateY: 180, scale: [1.04, 0.97, 1], opacity: 1, x: 0 }
            }
            transition={
              !revealed
                ? { scale: { duration: buildMs / 1000, ease: "easeOut" }, opacity: { duration: 0.3 }, x: { duration: 0.4, delay: Math.max(0, buildMs / 1000 - 0.45) } }
                : { rotateY: { duration: flipMs / 1000, ease: EASE.out }, scale: { duration: flipMs / 1000, ease: EASE.out } }
            }
          >
            <CardBack accent={accent} chargeColor={accent} charged={revealed ? 1 : charge} className="w-[300px]"
              style={{ backfaceVisibility: "hidden", ...(reduced ? { opacity: revealed ? 0 : 1, transition: `opacity ${flipMs}ms ease` } : {}) }} />
            {/* Barrido de luz sobre el dorso (una pasada). Reducido: no. */}
            {stage === "buildup" && !reduced && (
              <motion.span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ backfaceVisibility: "hidden" }}>
                <motion.span className="absolute inset-y-0 w-1/3" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)", skewX: -18 }}
                  initial={{ x: "-120%" }} animate={{ x: "320%" }} transition={{ duration: buildMs / 1000, ease: "easeInOut" }} />
              </motion.span>
            )}
            <div className="absolute inset-0" data-face="front" aria-hidden={!revealed}
              style={reduced ? { opacity: revealed ? 1 : 0, transition: `opacity ${flipMs}ms ease ${Math.round(flipMs * 0.2)}ms` } : { backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
              <CardVisual uid={result.uid} alt={`Carta de ${item.cardId}`} chamfer="21px" className="w-[300px]">
                <PlayerCard card={result.card} size="lg" serial={result.serial} interactive={false} />
              </CardVisual>
            </div>
          </motion.div>
        </div>
      </div>

      {/* LA FICHA + CONTINUAR · mismo hueco en todos los estados: la escena no salta. */}
      <div className="relative mt-4 flex min-h-[170px] w-full max-w-md shrink-0 flex-col items-center gap-2 text-center" onClick={(e) => e.stopPropagation()}>
        {stage === "buildup" && (
          <p className="font-display text-label font-bold uppercase tracking-wide2 text-white/70" data-testid="hero-buildup-copy">La mejor carta del sobre…</p>
        )}
        {revealed && (
          <motion.div className="flex flex-col items-center gap-1.5" initial={{ opacity: 0, y: reduced ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0.15 : flipMs / 1000 * 0.6 }} data-testid="hero-info">
            <div className="flex flex-wrap items-center justify-center gap-2" data-testid="hero-badges">
              <span className="nx-clip-sm px-4 py-1 font-display text-caption font-bold uppercase tracking-wide" style={{ background: accent, color: variant.palette.text }} data-badge="rarity">{item.rarityLabel}</span>
              <span className="nx-clip-sm border border-white/15 px-3 py-1 font-display text-label font-bold uppercase tracking-wide2 text-white/80" data-badge="edition">{variant.label}</span>
              {item.status === "new" && <span className="nx-clip-sm bg-drl px-3 py-1 font-display text-label font-bold uppercase tracking-wide2 text-white" data-badge="new">{item.newVariant ? "Nueva variante" : "Nueva en tu colección"}</span>}
              {item.status === "duplicate" && <span className="nx-clip-sm bg-white/10 px-3 py-1 font-display text-label font-bold uppercase tracking-wide2 text-white/85" data-badge="duplicate">Duplicada · ×{item.copiesAfter}</span>}
              {item.serialText && <span className="nx-clip-sm bg-white/10 px-3 py-1 font-display text-label font-bold uppercase tracking-wide2 text-white/85" data-badge="serial">{item.serialText}</span>}
            </div>
            {player && (
              <p className="font-display text-caption uppercase tracking-wide2 text-ink-muted" data-testid="hero-line">
                <b className="text-white">{player.nick}</b><span className="mx-1.5 text-ink-faint">·</span>
                <span className="nx-readout text-white">{item.card.ovr}</span> OVR<span className="mx-1.5 text-ink-faint">·</span>
                {item.card.role ?? player.role}{team && <><span className="mx-1.5 text-ink-faint">·</span>{team}</>}
              </p>
            )}
          </motion.div>
        )}
        {stage === "hero_hold" && (
          <motion.div className="mt-2 flex w-full flex-col items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
            <NxButton ref={continueRef} variant="primary" size="lg" onClick={(e) => { e.stopPropagation(); onContinue(); }} data-testid="hero-continue" className="!min-h-[56px] w-full max-w-[320px]">
              {total > 1 ? `Continuar · ${total - 1} más` : "Ver resumen"}
            </NxButton>
          </motion.div>
        )}
      </div>
    </div>
  );
}
