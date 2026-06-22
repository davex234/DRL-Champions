"use client";

import { motion } from "framer-motion";

/**
 * Arte del sobre sellado con movimiento flotante, reflejos y luz dinámica.
 * `cutProgress` (0-1) controla cómo se rasga el sobre por la línea de corte.
 */
export function SealedPack({
  accent,
  name,
  cutProgress,
}: {
  accent: string;
  name: string;
  cutProgress: number;
}) {
  const opened = cutProgress > 0.001;

  return (
    <div className="relative" style={{ width: 260, height: 380, transformStyle: "preserve-3d" }}>
      {/* Resplandor de fondo */}
      <div
        className="absolute -inset-8 -z-10 rounded-[40px] opacity-60 blur-3xl"
        style={{ background: accent }}
      />

      {/* Cuerpo del sobre */}
      <div
        className="absolute inset-0 overflow-hidden rounded-2xl border-2 shadow-card"
        style={{
          borderColor: accent,
          background: `linear-gradient(160deg, #11131f 0%, #060710 60%, #11131f 100%)`,
        }}
      >
        {/* Patrón de rejilla */}
        <div className="absolute inset-0 bg-grid opacity-40" />

        {/* Franja de acento diagonal */}
        <div
          className="absolute -inset-x-10 top-1/2 h-24 -translate-y-1/2 -rotate-12 opacity-30 blur-md"
          style={{ background: accent }}
        />

        {/* Reflejo que barre la superficie */}
        <motion.div
          aria-hidden
          className="absolute inset-y-0 w-1/3 -skew-x-12"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)",
          }}
          animate={{ x: ["-150%", "350%"] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.6 }}
        />

        {/* Logo / marca */}
        <div className="absolute inset-x-0 top-10 flex flex-col items-center">
          <div
            className="grid h-16 w-16 place-items-center rounded-xl font-display text-3xl font-bold text-white shadow-glow"
            style={{ background: `linear-gradient(135deg, ${accent}, #7b1733)` }}
          >
            D
          </div>
          <p className="mt-3 font-display text-xl font-bold uppercase tracking-[0.2em] text-white">
            DRL
          </p>
          <p className="font-display text-sm uppercase tracking-[0.3em] text-white/60">
            Champions
          </p>
        </div>

        {/* Nombre del sobre */}
        <div className="absolute inset-x-0 bottom-8 px-4 text-center">
          <p
            className="font-display text-base font-bold uppercase tracking-wider"
            style={{ color: accent }}
          >
            {name}
          </p>
        </div>
      </div>

      {/* Línea de corte luminosa que sigue el progreso */}
      <motion.div
        aria-hidden
        className="absolute left-0 right-0 z-20"
        style={{
          top: 64,
          height: 3,
          background: `linear-gradient(90deg, transparent, #fff, ${accent}, #fff, transparent)`,
          boxShadow: `0 0 18px #fff, 0 0 30px ${accent}`,
          scaleX: cutProgress,
          opacity: opened ? 1 : 0,
          transformOrigin: "left center",
        }}
      />

      {/* Solapa superior que se levanta al cortar */}
      <motion.div
        className="absolute inset-x-0 top-0 z-10 overflow-hidden rounded-t-2xl border-2"
        style={{
          height: 66,
          borderColor: accent,
          background: `linear-gradient(160deg, #1a1d2e 0%, #0a0c16 100%)`,
          transformOrigin: "top center",
          transformPerspective: 700,
          rotateX: -160 * cutProgress,
        }}
      >
        <div className="absolute inset-0 bg-grid opacity-40" />
      </motion.div>
    </div>
  );
}
