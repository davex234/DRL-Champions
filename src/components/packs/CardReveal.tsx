"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { OpenedResult } from "@/store/useGameStore";
import { getVariant } from "@/domain/cards/variants";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { ParticleBurst, Confetti } from "./Particles";
import { ceremonyFor, stillCeremony } from "./ceremony";
import { playReveal } from "@/lib/sound";
import { formatCredits } from "@/lib/format";
import { EASE } from "@/design/motion";

/**
 * LA REVELACIÓN DE UNA CARTA (Fase 9.6).
 *
 * La ceremonia tiene tres actos y el orden importa:
 *
 *   1. **TENSIÓN.** El dorso, quieto, y a su alrededor un ANILLO DE CARGA que se llena.
 *      Es la pieza nueva y la más importante: mientras se llena, el jugador ya sabe que
 *      algo va a pasar y —por su color y por lo que tarda— intuye CUÁNTO. Antes aquí no
 *      había nada: el dorso flotaba un rato indeterminado y giraba sin avisar.
 *   2. **GIRO.** Destello y volteo 3D.
 *   3. **ATERRIZAJE.** Aura de rareza, onda de choque, esquirlas y la placa con el nombre.
 *
 * Lo que decide la intensidad de cada acto NO se escribe aquí: viene de `ceremony.ts`,
 * que traduce el nivel de animación de la variante del dominio en una receta. Aquí solo
 * se dibuja.
 *
 * `prefers-reduced-motion` recibe `stillCeremony`: la carta, su color y nada más.
 */
export function CardReveal({
  result,
  index,
  total,
  onNext,
}: {
  result: OpenedResult;
  index: number;
  total: number;
  onNext: () => void;
}) {
  const reduced = useReducedMotion();
  const variant = getVariant(result.card.variantId);
  const [revealed, setRevealed] = useState(false);
  const accent = variant.palette.primary;

  const spec = useMemo(() => {
    const base = ceremonyFor(variant);
    return reduced ? stillCeremony(base) : base;
  }, [variant, reduced]);

  useEffect(() => {
    setRevealed(false);
    const t = setTimeout(() => {
      setRevealed(true);
      playReveal(variant.rank);
    }, spec.buildup);
    return () => clearTimeout(t);
  }, [result.uid, spec.buildup, variant.rank]);

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

  return (
    <div
      className="absolute inset-0 z-20 grid place-items-center"
      onClick={revealed ? onNext : undefined}
      style={{ cursor: revealed ? "pointer" : "default" }}
    >
      {/*
        ACTO 0 — la sala se apaga. Solo en las rarezas altas, y ANTES del giro. Es lo que
        hace que la luz que viene después se lea como un acontecimiento: sobre un fondo ya
        iluminado, encender más luz no se nota.
      */}
      {spec.dim > 0 && (
        <motion.div
          aria-hidden
          className="absolute inset-0 bg-black"
          initial={{ opacity: 0 }}
          animate={{ opacity: revealed ? spec.dim * 0.45 : spec.dim }}
          transition={{ duration: 0.6 }}
        />
      )}

      {/* Fondo de color por rareza al revelar. */}
      <motion.div
        aria-hidden
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: revealed ? 0.32 : 0 }}
        transition={{ duration: 0.5 }}
        style={{ background: `radial-gradient(circle at 50% 45%, ${accent}, transparent 60%)` }}
      />

      {/* Corona radial. Solo la parte alta de la escalera. */}
      {revealed && spec.rays && (
        <motion.div
          aria-hidden
          className="absolute h-[160vmax] w-[160vmax] opacity-30"
          style={{
            background: `conic-gradient(from 0deg, transparent 0deg, ${accent} 6deg, transparent 12deg, transparent 30deg, ${accent} 36deg, transparent 42deg)`,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
        />
      )}

      {/*
        ONDA DE CHOQUE. Un anillo que se expande UNA vez desde la carta. Es lo que da la
        sensación de impacto sin recurrir a más partículas: un solo elemento, un solo
        `transform`, y la percepción de que algo ha aterrizado.
      */}
      {revealed && spec.ring && (
        <motion.span
          aria-hidden
          className="absolute rounded-full border-2"
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
            className="absolute"
            style={{
              width: s.size,
              height: s.size * 2.1,
              background: accent,
              clipPath: "polygon(50% 0, 100% 100%, 0 100%)",
              filter: `drop-shadow(0 0 8px ${accent})`,
            }}
            initial={{ x: s.x * 2.4, y: 120, opacity: 0, rotate: 0 }}
            animate={{ y: -s.drift, opacity: [0, 0.95, 0], rotate: s.x > 0 ? 28 : -28 }}
            transition={{ duration: 1.5, delay: s.delay, ease: "easeOut" }}
          />
        ))}

      {revealed && spec.confetti && <Confetti />}
      {revealed && spec.burst > 0 && (
        <ParticleBurst color={accent} big={spec.burst > 60} count={spec.burst} />
      )}

      {/*
        Contador. Puntos, no «Carta 2 / 5»: la fila de puntos dice cuánto queda de un
        vistazo, que es lo que se mira aquí, y no obliga a leer.
      */}
      <div className="absolute top-6 flex items-center gap-1.5" aria-label={`Carta ${index + 1} de ${total}`}>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className="h-1.5 rounded-full transition-all duration-normal"
            style={{
              width: i === index ? 22 : 8,
              background: i <= index ? accent : "rgba(255,255,255,0.2)",
              boxShadow: i === index ? `0 0 12px ${accent}` : undefined,
            }}
          />
        ))}
      </div>

      <div className="relative grid place-items-center">
        {/*
          ANILLO DE CARGA. La tensión, hecha visible. Un círculo SVG cuyo trazo se completa
          durante exactamente `buildup` milisegundos: por lo que tarda en cerrarse ya se
          intuye si viene una Bronce o una Icon Series. Desaparece al girar la carta.
        */}
        {!revealed && !reduced && (
          <svg
            aria-hidden
            className="pointer-events-none absolute h-[420px] w-[420px] -rotate-90"
            viewBox="0 0 120 120"
          >
            <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
            <motion.circle
              cx="60" cy="60" r="54" fill="none"
              stroke={accent} strokeWidth="2.5" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 54}
              initial={{ strokeDashoffset: 2 * Math.PI * 54 }}
              animate={{ strokeDashoffset: 0 }}
              transition={{ duration: spec.buildup / 1000, ease: "linear" }}
              style={{ filter: `drop-shadow(0 0 8px ${accent})` }}
            />
          </svg>
        )}

        {/* Carta con volteo 3D. */}
        <motion.div
          className="relative"
          style={{ transformStyle: "preserve-3d", transformPerspective: 1200 }}
          initial={{ rotateY: 0, y: 40, opacity: 0 }}
          animate={{
            rotateY: revealed ? 180 : 0,
            y: revealed ? 0 : reduced ? 0 : [0, -16, 0],
            opacity: 1,
            scale: revealed ? 1 : 0.96,
          }}
          transition={
            revealed
              ? { rotateY: { duration: 0.7, ease: EASE.out }, y: { duration: 0.5 } }
              : { y: { duration: 2.4, repeat: Infinity, ease: "easeInOut" }, opacity: { duration: 0.4 } }
          }
        >
          {/* Dorso de la carta. */}
          <div
            className="nx-clip relative overflow-hidden border-2 shadow-card"
            style={{
              width: 300,
              aspectRatio: "5 / 7",
              backfaceVisibility: "hidden",
              borderColor: accent,
              background: `linear-gradient(160deg,#171a2b,#06070d 60%,#11131f)`,
            }}
          >
            <div aria-hidden className="absolute inset-0 bg-grid opacity-30" />
            <div
              aria-hidden
              className="absolute inset-0 opacity-60"
              style={{
                backgroundImage: `repeating-linear-gradient(115deg, ${accent}00 0px, ${accent}18 2px, ${accent}00 10px, ${accent}00 28px)`,
              }}
            />
            {/*
              El dorso llevaba una «D» —de la marca antigua— dentro de un cuadrado con
              degradado. Ahora lleva el sigilo de NEXUS, el mismo troquel que el sobre: lo
              que sale es de la misma familia que aquello de donde ha salido.
            */}
            <div className="grid h-full place-items-center">
              <motion.svg
                viewBox="0 0 100 100"
                className="h-28 w-28"
                fill="none"
                animate={reduced ? undefined : { scale: [1, 1.06, 1], opacity: [0.75, 1, 0.75] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              >
                <path d="M50 10 L84 30 L84 70 L50 90 L16 70 L16 30 Z" stroke={accent} strokeWidth="2.4" />
                <path d="M34 34 L52 50 L34 66 Z" fill={accent} fillOpacity="0.55" stroke={accent} strokeWidth="1.6" />
                <path d="M66 34 L48 50 L66 66 Z" fill={accent} fillOpacity="0.22" stroke={accent} strokeWidth="1.6" />
              </motion.svg>
            </div>
          </div>

          {/* Cara revelada. */}
          <div
            className="absolute inset-0"
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
          >
            <PlayerCard card={result.card} size="lg" serial={result.serial} interactive={false} />
          </div>
        </motion.div>
      </div>

      {/*
        HERALDO. La rareza se CANTA antes de que la carta se vea. Es el mecanismo de
        tensión más barato que existe: una palabra durante el último tramo de la carga.
        Las rarezas bajas no cantan nada, y por eso cuando algo canta, importa.
      */}
      {!revealed && spec.herald && (
        <motion.p
          className="absolute bottom-28 font-display text-sm font-bold uppercase tracking-[0.4em]"
          style={{ color: accent, textShadow: `0 0 24px ${accent}` }}
          initial={{ opacity: 0, letterSpacing: "0.9em" }}
          animate={{ opacity: 1, letterSpacing: "0.4em" }}
          transition={{ duration: 0.7, delay: spec.buildup / 1000 - 0.75 }}
        >
          {spec.herald}
        </motion.p>
      )}

      {/* Placa de resultado: rareza, valor y si es nueva. */}
      {revealed && (
        <motion.div
          className="absolute bottom-24 flex flex-col items-center gap-2"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <div className="flex items-center gap-2">
            {result.isNew && (
              <span className="nx-clip-sm bg-drl px-3 py-1 font-display text-xs font-bold uppercase tracking-wider text-white shadow-glow">
                ¡Nueva!
              </span>
            )}
            <span
              className="nx-clip-sm px-4 py-1 font-display text-sm font-bold uppercase tracking-wider"
              style={{ background: accent, color: variant.palette.text }}
            >
              {variant.label}
            </span>
          </div>
          <p className="nx-readout text-sm text-drl-gold">🪙 {formatCredits(result.value)}</p>
        </motion.div>
      )}

      {/* Pista para continuar. */}
      {revealed && (
        <motion.p
          className="absolute bottom-8 font-display text-xs uppercase tracking-[0.3em] text-white/50"
          animate={reduced ? undefined : { opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.6, repeat: Infinity }}
        >
          {index + 1 < total ? "Toca para la siguiente" : "Toca para ver el resumen"}
        </motion.p>
      )}
    </div>
  );
}
