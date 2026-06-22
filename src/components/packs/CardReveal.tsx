"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { OpenedResult } from "@/store/useGameStore";
import { getVariant } from "@/domain/cards/variants";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { ParticleBurst, Confetti } from "./Particles";
import { playReveal } from "@/lib/sound";
import { formatCredits } from "@/lib/format";

/** Duración de la tensión previa al revelado según el nivel de animación. */
const BUILDUP: Record<string, number> = {
  basic: 350,
  metallic: 550,
  premium: 800,
  special: 1100,
  winner: 1300,
  extended: 1300,
  cinematic: 1900,
  legendary: 2300,
  icon: 2700,
};

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
  const variant = getVariant(result.card.variantId);
  const [revealed, setRevealed] = useState(false);
  const accent = variant.palette.primary;

  useEffect(() => {
    setRevealed(false);
    const t = setTimeout(() => {
      setRevealed(true);
      playReveal(variant.rank);
    }, BUILDUP[variant.animation] ?? 800);
    return () => clearTimeout(t);
  }, [result.uid, variant.animation, variant.rank]);

  const isCinematic = variant.animation === "cinematic" || variant.animation === "legendary" || variant.animation === "icon";
  const isWinner = variant.animation === "winner";

  return (
    <div
      className="absolute inset-0 z-20 grid place-items-center"
      onClick={revealed ? onNext : undefined}
      style={{ cursor: revealed ? "pointer" : "default" }}
    >
      {/* Fondo de color por rareza al revelar */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: revealed ? 0.28 : 0 }}
        transition={{ duration: 0.5 }}
        style={{ background: `radial-gradient(circle at 50% 45%, ${accent}, transparent 60%)` }}
      />

      {/* Rayos giratorios para alta rareza */}
      {revealed && isCinematic && (
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

      {/* Efectos al revelar */}
      {revealed && isWinner && <Confetti />}
      {revealed && variant.rank >= 6 && (
        <ParticleBurst color={accent} big={isCinematic} count={isCinematic ? 90 : 50} />
      )}

      {/* Contador de cartas */}
      <div className="absolute top-6 font-display text-sm uppercase tracking-[0.3em] text-white/50">
        Carta {index + 1} / {total}
      </div>

      {/* Carta con flip 3D */}
      <motion.div
        className="relative"
        style={{ transformStyle: "preserve-3d", transformPerspective: 1200 }}
        initial={{ rotateY: 0, y: 40, opacity: 0 }}
        animate={{
          rotateY: revealed ? 180 : 0,
          y: revealed ? 0 : [0, -16, 0],
          opacity: 1,
          scale: revealed ? 1 : 0.96,
        }}
        transition={
          revealed
            ? { rotateY: { duration: 0.7, ease: [0.22, 1, 0.36, 1] }, y: { duration: 0.5 } }
            : { y: { duration: 2.4, repeat: Infinity, ease: "easeInOut" }, opacity: { duration: 0.4 } }
        }
      >
        {/* Dorso de la carta */}
        <div
          className="overflow-hidden rounded-2xl border-2 shadow-card"
          style={{
            width: 300,
            aspectRatio: "5 / 7",
            backfaceVisibility: "hidden",
            borderColor: accent,
            background: "linear-gradient(160deg,#11131f,#06070d)",
          }}
        >
          <div className="absolute inset-0 bg-grid opacity-40" />
          <div className="grid h-full place-items-center">
            <motion.div
              className="grid h-20 w-20 place-items-center rounded-xl font-display text-4xl font-bold text-white"
              style={{ background: `linear-gradient(135deg, ${accent}, #7b1733)` }}
              animate={{ scale: [1, 1.08, 1], boxShadow: [`0 0 20px ${accent}`, `0 0 45px ${accent}`, `0 0 20px ${accent}`] }}
              transition={{ duration: 1.1, repeat: Infinity }}
            >
              D
            </motion.div>
          </div>
        </div>

        {/* Cara revelada */}
        <div
          className="absolute inset-0"
          style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
        >
          <PlayerCard card={result.card} size="lg" serial={result.serial} interactive={false} />
        </div>
      </motion.div>

      {/* Etiqueta de rareza + valor + nueva */}
      {revealed && (
        <motion.div
          className="absolute bottom-24 flex flex-col items-center gap-2"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <div className="flex items-center gap-2">
            {result.isNew && (
              <span className="rounded-full bg-drl px-2.5 py-0.5 font-display text-xs font-bold uppercase tracking-wider text-white shadow-glow">
                ¡Nueva!
              </span>
            )}
            <span
              className="rounded-full px-3 py-0.5 font-display text-sm font-bold uppercase tracking-wider"
              style={{ background: accent, color: variant.palette.text }}
            >
              {variant.label}
            </span>
          </div>
          <p className="font-display text-sm text-drl-gold">
            🪙 {formatCredits(result.value)}
          </p>
        </motion.div>
      )}

      {/* Pista para continuar */}
      {revealed && (
        <motion.p
          className="absolute bottom-8 font-display text-xs uppercase tracking-[0.3em] text-white/50"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.6, repeat: Infinity }}
        >
          {index + 1 < total ? "Toca para la siguiente" : "Toca para ver el resumen"}
        </motion.p>
      )}
    </div>
  );
}
