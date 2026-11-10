"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { OpenedResult } from "@/store/useGameStore";
import type { RevealItem } from "@/domain/packs/reveal";
import { getVariant } from "@/domain/cards/variants";
import { canonicalCardTeam } from "@/data/teamIdentities";
import { getPlayer } from "@/data/catalog";
import { COMBAT_STAT_META, COMBAT_STAT_ORDER } from "@/domain/cards/combat";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardVisual } from "@/components/cards/CardVisual";
import { ParticleBurst } from "./Particles";
import { CardBack } from "./CardBack";
import { ceremonyFor, stillCeremony, lastCardCeremony, rarityCeremony, MAX_BURST } from "./ceremony";
import { playReveal, playCue } from "@/lib/sound";
import { buzz } from "@/lib/haptics";
import { EASE } from "@/design/motion";
import { td } from "@/i18n/runtime";

/**
 * LA REVELACIÓN DE UNA CARTA.
 *
 * La ceremonia tiene tres actos y el orden importa:
 *
 *   1. **TENSIÓN.** El dorso, quieto, y a su alrededor un ANILLO DE CARGA que se llena.
 *      Mientras se llena, el jugador ya sabe que algo va a pasar y —por su color y por lo
 *      que tarda— intuye CUÁNTO. El dorso además se CARGA: su canto se enciende con el
 *      color de la rareza que viene (§9).
 *   2. **GIRO.** Volteo 3D.
 *   3. **ATERRIZAJE.** Aura de rareza, onda de choque, esquirlas y la ficha con los datos.
 *
 * ────────────────────────── FASE 38 · THE REVEAL ──────────────────────────
 *
 * **1. La presenta el PLAN (`domain/packs/reveal`), no esta pieza.** Rareza real del catálogo (común → legendaria),
 * NUEVA EN TU COLECCIÓN / NUEVA VARIANTE / DUPLICADA ×N calculado contra la colección de ANTES de abrir, serial
 * canónico `#N/LÍMITE` y su prestigio (#1 / Top 10 / Top 100, sin efecto de juego), anticipación por rareza y la
 * frase para lector de pantalla. Aquí solo se dibuja.
 *
 * **2. Controlada por la máquina de estados.** `revealed` llega de fuera: el temporizador de la anticipación solo
 * AVISA (`onShown`), y «siguiente» durante la anticipación gira la carta en vez de saltársela.
 *
 * **3. Sin economía ni celebración infantil.** Se quitó el valor en monedas y el confeti. El serial #1 tiene su
 * momento (halo fijo, heraldo «Serial #1», pausa), la legendaria el suyo (sala apagada, corona), y ninguno concede nada.
 *
 * **4. Cada carta es su instancia.** `data-uid`, `data-card-id` y `data-serial` salen del resultado persistido: la
 * cara, las stats y el serial son del MISMO ejemplar.
 *
 * `prefers-reduced-motion` recibe `stillCeremony`: la carta, su color y nada más.
 *
 * ────────────────────────── FASE 57 · PACK OPENING 5.0 ──────────────────────────
 *
 * **La carta espera al gesto.** Boca abajo y en reposo flota y dice «toca para revelar»; el toque la ARMA (`armed`,
 * de la máquina de estados) y solo entonces corre su anticipación, medida con su rareza REAL: una común gira casi en
 * el acto; una épica apaga la sala y enciende energía detrás del dorso; la legendaria (o el serial #1) añade un
 * destello dorado CONTENIDO alrededor de la carta —no una pantalla blanca— y una pausa para contemplarla. Un segundo
 * toque durante la anticipación gira ya. La cara es la del ejemplar (`CardVisual` → `CardArt`), sin caja alrededor.
 */
export function CardReveal({
  result,
  item,
  index,
  total,
  isLast,
  onNext,
  onCharge,
  revealed: revealedProp,
  onShown,
  reducedOverride,
  armed: armedProp,
}: {
  result: OpenedResult;
  /** Fase 38 · lo que hay que contar de esta carta (rareza, nueva/duplicada, serial, anuncio). */
  item?: RevealItem;
  index: number;
  total: number;
  /** La última del sobre: más ceremonia, la MISMA carta (ver `lastCardCeremony`). */
  isLast?: boolean;
  onNext: () => void;
  /**
   * Informa a la escena del avance de la carga (0-1) y del color de la rareza que viene,
   * para que el abanico del pie cargue el mismo hueco. Presentación: no decide nada.
   */
  onCharge?: (charge: number, color: string) => void;
  /** Controlado por la máquina de estados de presentación. Sin él, la carta gira sola. */
  revealed?: boolean;
  onShown?: () => void;
  /** Solo para el arnés QA: forzar movimiento reducido. */
  reducedOverride?: boolean;
  /** Fase 57 · el jugador ya tocó la carta: corre su anticipación. Sin la prop (modo no controlado), gira sola. */
  armed?: boolean;
}) {
  const prefersReduced = useReducedMotion();
  const reduced = reducedOverride ?? !!prefersReduced;
  const variant = getVariant(result.card.variantId);
  const player = getPlayer(result.card.playerId);
  const controlled = revealedProp !== undefined;
  const [innerRevealed, setInnerRevealed] = useState(false);
  const revealed = controlled ? !!revealedProp : innerRevealed;
  /* Fase 57 · la anticipación solo corre tras el gesto (controlado) o siempre (no controlado, compatibilidad). */
  const running = controlled && armedProp !== undefined ? !!armedProp : true;
  const accent = variant.palette.primary;
  const containerRef = useRef<HTMLDivElement>(null);
  const shownFor = useRef<string | null>(null);

  const spec = useMemo(() => {
    const base = item ? rarityCeremony(item.rarity) : ceremonyFor(variant);
    const conFinal = isLast ? lastCardCeremony(base) : base;
    return reduced ? stillCeremony(conFinal) : conFinal;
  }, [variant, reduced, isLast, item]);
  /*
   * Fase 57.1 · con movimiento reducido la anticipación SIGUE existiendo (la sala se apaga y el dorso se carga con el
   * color real), solo más corta: de ~0,35 s en una común a ~0,9 s en una legendaria. Antes eran 0,18 s para todas.
   */
  const reducedHold = item ? Math.min(900, 350 + ({ common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 } as const)[item.rarity] * 140) : 350;
  const hold = reduced ? reducedHold : item ? item.holdMs + (isLast ? 300 : 0) : spec.buildup;
  /** La sala se apaga también con movimiento reducido: es luz, no movimiento. */
  const dim = reduced ? (item ? rarityCeremony(item.rarity).dim : 0) : spec.dim;
  const herald = item ? item.herald : spec.herald;
  const numberOne = item?.prestige?.tier === "NUMBER_ONE";
  /** El nivel visual máximo existente: legendaria (Icon y similares) o serial #1. Sale del ejemplar real. */
  const maxMoment = item?.rarity === "legendary" || numberOne;

  useEffect(() => {
    if (!controlled) setInnerRevealed(false);
  }, [result.uid, controlled]);

  /* La anticipación solo AVISA: quien decide que la carta está girada es la máquina de estados. */
  useEffect(() => {
    if (revealed || !running) return;
    const t = setTimeout(() => {
      if (controlled) onShown?.();
      else setInnerRevealed(true);
    }, hold);
    return () => clearTimeout(t);
  }, [result.uid, revealed, running, hold, controlled, onShown]);

  /* Sonido, vibración y foco: UNA vez por ejemplar, al girar. Sin sonido antes de un gesto (primeAudio lo abre). */
  useEffect(() => {
    if (!revealed || shownFor.current === result.uid) return;
    shownFor.current = result.uid;
    playReveal(variant.rank);
    if (numberOne) { playCue("round_win"); buzz("match"); }
    else if (item && (item.rarity === "legendary" || item.rarity === "epic")) buzz("point");
    containerRef.current?.focus({ preventScroll: true });
  }, [revealed, result.uid, variant.rank, item, numberOne]);

  /*
    LA CARGA, COMPARTIDA CON EL ABANICO. El anillo de carga y el canto del dorso cuentan lo
    mismo, así que se alimentan del mismo reloj. Es un temporizador de progreso, no una
    animación por fotograma: seis pasos bastan para que se lea como una cuenta atrás.
  */
  const [charge, setCharge] = useState(0);
  useEffect(() => {
    if (revealed || !running) { if (!revealed) setCharge(0); return; }
    const pasos = 6;
    const ids = Array.from({ length: pasos }, (_, k) =>
      setTimeout(() => {
        const c = (k + 1) / pasos;
        setCharge(c);
        onCharge?.(c, accent);
      }, (hold / pasos) * (k + 1)),
    );
    return () => ids.forEach(clearTimeout);
  }, [result.uid, revealed, running, hold, accent, onCharge]);

  /** Esquirlas: se calculan una vez por carta y no cambian mientras dura. */
  const shards = useMemo(
    () =>
      Array.from({ length: spec.shards }, (_, i) => ({
        id: i,
        x: (i / Math.max(1, spec.shards - 1)) * 100 - 50,
        delay: 0.05 + (i % 5) * 0.07,
        size: 7 + ((i * 13) % 11),
        drift: 130 + ((i * 37) % 120),
      })),
    [spec.shards],
  );

  const stats = result.card.combat
    ? COMBAT_STAT_ORDER.map((k) => ({ k, label: COMBAT_STAT_META[k].label, full: COMBAT_STAT_META[k].full, value: result.card.combat![k] }))
    : [];

  return (
    <div
      ref={containerRef}
      tabIndex={revealed ? 0 : -1}
      className="nx-focus absolute inset-0 z-floating flex flex-col items-center justify-center gap-5 px-4 pb-36 pt-8 outline-none"
      onClick={onNext}
      style={{ cursor: "pointer" }}
      role="button"
      aria-label={
        revealed
          ? index + 1 < total
            ? "Revelar la siguiente carta"
            : "Ver el resumen del sobre"
          : running ? "Girar la carta ya" : `Revelar la carta ${index + 1} de ${total}`
      }
      data-testid="reveal-card"
      data-uid={result.uid}
      data-card-id={result.card.id}
      data-serial={result.serial ?? ""}
      data-rarity={item?.rarity}
      data-status={item?.status}
      data-moment={item?.moment}
      data-revealed={String(revealed)}
      data-armed={String(running && !revealed)}
      data-max={maxMoment ? "true" : undefined}
    >
      {/* Lector de pantalla: una frase por carta, sin leer cuarenta detalles. */}
      <p className="sr-only" aria-live="polite" data-testid="reveal-announcement">
        {revealed ? item?.announcement ?? `${player?.nick ?? result.card.id}. OVR ${result.card.ovr}.` : `Carta ${index + 1} de ${total}. Revelando.`}
      </p>

      {/*
        ACTO 0 — la sala se apaga. Solo en las rarezas altas, y ANTES del giro. Es lo que
        hace que la luz que viene después se lea como un acontecimiento.
      */}
      {dim > 0 && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-black"
          initial={{ opacity: 0 }}
          animate={{ opacity: revealed ? dim * 0.45 : running ? dim : dim * 0.35 }}
          transition={{ duration: 0.6 }}
        />
      )}

      {/*
        FASE 44 · NIVEL 4 — legendaria y serial #1: la LUZ DE LA SALA reacciona una vez al girar (sube y se asienta,
        ~1,1 s, sin bucle). El resultado ya llegó del servidor (esta pieza solo existe con el plan): no anticipa nada.
        Con movimiento reducido queda un halo fijo, que sigue diciendo «esto es excepcional».
      */}
      {revealed && (item?.rarity === "legendary" || numberOne) && (
        <span aria-hidden className="nx-screen-light" data-on="true" data-testid="reveal-screen-light" data-motion-level="4" style={{ ["--light-rgb" as string]: numberOne ? "255 211 92" : "255 170 70" }} />
      )}

      {/* Fondo de color por rareza al revelar. Sin destellos: una sola subida de opacidad. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: revealed ? 0.32 : 0 }}
        transition={{ duration: reduced ? 0 : 0.5 }}
        style={{ background: `radial-gradient(circle at 50% 45%, ${accent}, transparent 60%)` }}
      />

      {/* Corona radial. Solo la parte alta de la escalera, y nunca con movimiento reducido. */}
      {revealed && spec.rays && !reduced && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute h-[160vmax] w-[160vmax] opacity-30"
          style={{
            background: `conic-gradient(from 0deg, transparent 0deg, ${accent} 6deg, transparent 12deg, transparent 30deg, ${accent} 36deg, transparent 42deg)`,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
        />
      )}

      {/*
        FASE 57 · ENERGÍA DETRÁS DEL DORSO durante la anticipación de las rarezas altas (las que ya tienen corona): líneas
        que giran despacio y se concentran en la carta. Solo tras el gesto, solo con la rareza REAL, nunca con movimiento reducido.
      */}
      {running && !revealed && spec.rays && !reduced && (
        <motion.div
          aria-hidden
          data-testid="reveal-energy"
          className="pointer-events-none absolute h-[120vmin] w-[120vmin] rounded-full"
          style={{
            background: `repeating-conic-gradient(from 0deg, transparent 0deg 9deg, ${accent}55 10deg, transparent 11deg 20deg)`,
            maskImage: "radial-gradient(circle, rgba(0,0,0,0.9) 8%, transparent 58%)",
            WebkitMaskImage: "radial-gradient(circle, rgba(0,0,0,0.9) 8%, transparent 58%)",
          }}
          initial={{ opacity: 0, scale: 1.4, rotate: 0 }}
          animate={{ opacity: 0.9, scale: 0.85, rotate: 50 }}
          transition={{ duration: hold / 1000, ease: "easeIn" }}
        />
      )}

      {/*
        FASE 57 · EL MOMENTO MÁXIMO: al girar una legendaria (o un serial #1) sale un destello dorado ALREDEDOR de la carta,
        contenido en su zona y breve (≈ 0,7 s), sin cubrir la pantalla ni tapar la carta. Movimiento reducido: nada.
      */}
      {/* Fase 57.1 · reducido: el momento máximo es una luz dorada QUIETA que aparece con un fundido (sin destello). */}
      {revealed && maxMoment && reduced && (
        <motion.span
          aria-hidden
          data-testid="reveal-max-glow"
          className="pointer-events-none absolute h-[80vmin] w-[80vmin] rounded-full"
          style={{ background: "radial-gradient(closest-side, rgba(255,211,92,0.45), rgba(255,211,92,0.12) 55%, transparent 75%)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
        />
      )}
      {revealed && maxMoment && !reduced && (
        <motion.span
          aria-hidden
          data-testid="reveal-max-flash"
          className="pointer-events-none absolute h-[92vmin] w-[92vmin] rounded-full"
          style={{ background: "radial-gradient(closest-side, rgba(255,240,200,0.95), rgba(255,211,92,0.55) 35%, transparent 72%)" }}
          initial={{ opacity: 0, scale: 0.35 }}
          animate={{ opacity: [0, 0.9, 0], scale: [0.35, 1, 1.25] }}
          transition={{ duration: 0.7, times: [0, 0.25, 1], ease: "easeOut" }}
        />
      )}

      {/* ONDA DE CHOQUE. Un anillo que se expande UNA vez desde la carta. */}
      {revealed && spec.ring && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute rounded-full border-2"
          style={{ borderColor: accent, width: 300, height: 300 }}
          initial={{ scale: 0.35, opacity: 0.9 }}
          animate={{ scale: 3.4, opacity: 0 }}
          transition={{ duration: 1.1, ease: "easeOut" }}
        />
      )}

      {/* Esquirlas ascendentes: el vocabulario geométrico de NEXUS, no chispas redondas. */}
      {revealed &&
        shards.map((s) => (
          <motion.span
            aria-hidden
            key={s.id}
            className="pointer-events-none absolute"
            style={{
              width: s.size,
              height: s.size * 2.1,
              background: accent,
              clipPath: "polygon(50% 0, 100% 100%, 0 100%)",
            }}
            initial={{ x: s.x * 2.4, y: 120, opacity: 0, rotate: 0 }}
            animate={{ y: -s.drift, opacity: [0, 0.95, 0], rotate: s.x > 0 ? 28 : -28 }}
            transition={{ duration: 1.5, delay: s.delay, ease: "easeOut" }}
          />
        ))}

      {revealed && spec.burst > 0 && (
        <ParticleBurst color={accent} big={spec.burst > 30} count={Math.min(spec.burst, MAX_BURST)} />
      )}

      {/*
        ── LA CARTA ──
        Se dibuja SIEMPRE a `lg` (300 px, el tamaño que fija `CardRenderer`) y se ESCALA con
        la pantalla. `transform` no ocupa espacio, así que esto no puede provocar scroll.
      */}
      <div className="relative grid shrink-0 place-items-center">
        {/* El anillo de carga es un indicador de progreso, no un movimiento: se mantiene con movimiento reducido. */}
        {!revealed && running && (
          <svg
            aria-hidden
            className="pointer-events-none absolute h-[320px] w-[320px] scale-[0.78] sm:h-[420px] sm:w-[420px] sm:scale-100 -rotate-90"
            viewBox="0 0 120 120"
          >
            <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
            <motion.circle
              cx="60" cy="60" r="54" fill="none"
              stroke={accent} strokeWidth="2.5" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 54}
              initial={{ strokeDashoffset: 2 * Math.PI * 54 }}
              animate={{ strokeDashoffset: 0 }}
              transition={{ duration: hold / 1000, ease: "linear" }}
            />
          </svg>
        )}

        {/* LA ESCALA, EN SU PROPIO NODO: framer-motion escribe `transform` entero para el volteo. */}
        <div className="relative origin-center scale-[0.72] xs:scale-[0.78] sm:scale-95 lg:scale-100">
        {/*
          SERIAL #1 — luz dorada DETRÁS de la carta (dentro de su escala: crece y encoge con ella y nunca cruza la
          ficha de texto). Prestigio visual: no concede nada. CARD ART = CARD VISUAL: antes era un marco con borde y
          sombra de caja alrededor de la carta — otra carta alrededor del asset —; ahora es luz ambiental, sin bordes.
        */}
        {revealed && numberOne && (
          <span
            aria-hidden
            data-moment="serial-one"
            className="pointer-events-none absolute -inset-10 rounded-full"
            style={{ background: "radial-gradient(50% 50% at 50% 50%, rgba(255,211,92,0.42), rgba(255,211,92,0.12) 55%, transparent 72%)" }}
          />
        )}
        <motion.div
          className="relative"
          style={{ transformStyle: "preserve-3d", transformPerspective: 1200 }}
          initial={{ rotateY: revealed && !reduced ? 180 : 0, y: reduced ? 0 : 40, opacity: 0, scale: 1 }}
          animate={{
            // Fase 57.1 · reducido: sin giro 3D; el dorso cede su sitio a la cara con un fundido (abajo).
            rotateY: revealed && !reduced ? 180 : 0,
            y: revealed || reduced ? 0 : running ? -10 : [0, -16, 0],
            // Fase 57 · aterrizaje (0,96 → 1) al girar; en la anticipación la carta se acerca un poco.
            scale: reduced ? 1 : revealed ? [0.96, 1] : running ? 1.04 : 1,
            opacity: 1,
          }}
          transition={
            revealed
              ? { rotateY: { duration: maxMoment ? 0.9 : 0.6, ease: EASE.out }, y: { duration: 0.5 }, scale: { duration: 0.45, ease: EASE.out } }
              : running
                ? { y: { duration: hold / 1000, ease: "easeOut" }, scale: { duration: hold / 1000, ease: "easeOut" }, opacity: { duration: 0.3 } }
                : { y: { duration: 2.4, repeat: Infinity, ease: "easeInOut" }, opacity: { duration: 0.4 } }
          }
        >
          {/* EL DORSO. La misma pieza que el abanico, cargándose con el color de la rareza REAL que viene. */}
          <CardBack
            accent={accent}
            chargeColor={accent}
            charged={!running ? 0 : charge}
            className="w-[300px]"
            style={{ backfaceVisibility: "hidden", ...(reduced ? { opacity: revealed ? 0 : 1, transition: "opacity 0.4s ease" } : {}) }}
          />

          {/* Cara revelada: el ejemplar persistido (su artwork por uid, su serial). */}
          <div
            className="absolute inset-0"
            style={reduced ? { opacity: revealed ? 1 : 0, transition: "opacity 0.4s ease 0.1s" } : { backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            aria-hidden={!revealed}
            data-face="front"
          >
            <CardVisual uid={result.uid} alt={`Carta de ${result.card.id}`} chamfer="21px" className="w-[300px]">
              <PlayerCard card={result.card} size="lg" serial={result.serial} interactive={false} />
            </CardVisual>
          </div>
        </motion.div>
        </div>
      </div>

      {/* ── EL HUECO DE ABAJO ── heraldo y ficha se alternan en el MISMO sitio: la escena no salta. */}
      <div className="flex min-h-[124px] shrink-0 flex-col items-center justify-start gap-2 text-center">
        {/* Fase 57 · en reposo, la invitación al gesto (texto, no solo movimiento). */}
        {!revealed && !running && (
          <motion.p
            className="font-display text-label font-bold uppercase tracking-wide2 text-white/75"
            data-testid="reveal-prompt"
            animate={reduced ? undefined : { opacity: [0.45, 1, 0.45] }}
            transition={{ duration: 1.8, repeat: Infinity }}
          >
            Toca la carta o pulsa Espacio para revelarla
          </motion.p>
        )}
        {!revealed && running && herald && (
          <motion.p
            className="font-display text-caption font-bold uppercase"
            style={{ color: numberOne ? "#ffd35c" : accent, letterSpacing: "0.4em" }}
            initial={{ opacity: 0, letterSpacing: reduced ? "0.4em" : "0.9em" }}
            animate={{ opacity: 1, letterSpacing: "0.4em" }}
            transition={{ duration: reduced ? 0.1 : 0.7, delay: reduced ? 0 : Math.max(0, hold / 1000 - 0.75) }}
            data-testid="reveal-herald"
          >
            {td(herald)}
          </motion.p>
        )}

        {/*
          LA FICHA. Jugador, OVR, rol, equipo, variante, RAREZA en texto (nunca solo color), serial y si es nueva o
          duplicada — todo del ejemplar real y del plan.
        */}
        {revealed && (
          <motion.div
            className="flex flex-col items-center gap-1.5"
            initial={{ opacity: 0, y: reduced ? 0 : 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduced ? 0 : 0.25 }}
          >
            <div className="flex flex-wrap items-center justify-center gap-2" data-testid="reveal-badges">
              {item?.status === "new" && (
                <span className="nx-clip-sm bg-drl px-3 py-1 font-display text-label font-bold uppercase tracking-wide2 text-white" data-badge="new">
                  {item.newVariant ? "Nueva variante" : "Nueva en tu colección"}
                </span>
              )}
              {item?.status === "duplicate" && (
                <span className="nx-clip-sm bg-white/10 px-3 py-1 font-display text-label font-bold uppercase tracking-wide2 text-white/85" data-badge="duplicate">
                  Duplicada · ×{item.copiesAfter}
                </span>
              )}
              {!item && result.isNew && (
                <span className="nx-clip-sm bg-drl px-3 py-1 font-display text-label font-bold uppercase tracking-wide2 text-white">
                  ¡Nueva!
                </span>
              )}
              <span
                className="nx-clip-sm px-4 py-1 font-display text-caption font-bold uppercase tracking-wide"
                style={{ background: accent, color: variant.palette.text }}
                data-badge="rarity"
              >
                {item ? item.rarityLabel : variant.label}
              </span>
              {item && (
                <span className="nx-clip-sm border border-white/15 px-3 py-1 font-display text-label font-bold uppercase tracking-wide2 text-white/80">
                  {variant.label}
                </span>
              )}
              {result.serial != null && (
                <span className="nx-clip-sm bg-white/10 px-3 py-1 font-display text-label font-bold uppercase tracking-wide2 text-white/85" data-badge="serial">
                  {item?.serialText ?? `Nº ${result.serial}${variant.serialLimit ? ` / ${variant.serialLimit}` : ""}`}
                </span>
              )}
              {item?.prestige && (
                <span
                  className="nx-clip-sm border border-drl-gold/60 bg-drl-gold/15 px-3 py-1 font-display text-label font-bold uppercase tracking-wide2 text-drl-gold"
                  data-badge="prestige"
                  data-prestige={item.prestige.tier}
                >
                  {numberOne ? "Serial #1" : item.prestige.label}
                </span>
              )}
            </div>

            {player && (
              <p className="font-display text-caption uppercase tracking-wide2 text-ink-muted">
                <b className="text-white">{player.nick}</b>
                <span className="mx-1.5 text-ink-faint">·</span>
                <span className="nx-readout text-white">{result.card.ovr}</span> OVR
                <span className="mx-1.5 text-ink-faint">·</span>
                {result.card.role ?? player.role}
                <span className="mx-1.5 text-ink-faint">·</span>
                {canonicalCardTeam(result.card, player).label}
              </p>
            )}

            {stats.length > 0 && (
              <p className="nx-readout text-caption text-ink-secondary" aria-label={stats.map((s) => `${s.full} ${s.value}`).join(", ")}>
                {stats.map((s) => `${s.label} ${s.value}`).join(" · ")}
              </p>
            )}

            {item?.prestige && (
              <p className="text-label text-ink-faint">El serial es prestigio: no cambia stats ni da recompensas.</p>
            )}

            {/* Pista para continuar. */}
            <motion.p
              className="mt-1 font-display text-label uppercase tracking-wide2 text-ink-faint"
              animate={reduced ? undefined : { opacity: [0.35, 1, 0.35] }}
              transition={{ duration: 1.6, repeat: Infinity }}
            >
              {index + 1 < total ? "Toca o pulsa Enter para la siguiente" : "Toca o pulsa Enter para ver el resumen"}
            </motion.p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
