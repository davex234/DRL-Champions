"use client";

/**
 * EL DORSO DE LA CARTA — una sola pieza para toda la ceremonia.
 *
 * ────────────────────────── POR QUÉ EXISTE ──────────────────────────
 *
 * El dorso estaba escrito DENTRO de `CardReveal`, a 300 px fijos, porque hasta ahora solo se
 * veía en un sitio: la carta que estaba a punto de girar. Al añadir el acto de las cinco
 * cartas boca abajo (`PackHand`) hacía falta el mismo dorso en dos sitios a la vez, y la
 * alternativa —copiarlo— habría creado dos dorsos que se irían separando con cada cambio.
 *
 * ────────────────────────── FASE 57 · EL DORSO ES UNA CARTA, NO UNA CAJA ──────────────────────────
 *
 * Antes era un `div` con borde, chaflán por `clip-path` y `box-shadow`: una caja pintada. Ahora es la SILUETA de
 * una carta dibujada en SVG (mismo chaflán que el CardArt, proporción 5/7 ≈ 750×1048) y toda la luz va por
 * `filter: drop-shadow`, que sigue el contorno: la regla de «la carta es el asset» aplicada también a su reverso.
 * Lleva la marca de la casa —sigilo hexagonal de NEXUS, filetes y la palabra NEXUS—, sin recursos de terceros.
 *
 * El color es el del SOBRE mientras la carta está boca abajo: **el dorso no puede filtrar lo que hay delante.**
 * `charged` (0-1) es la anticipación: su color lo elige quien llama con la rareza REAL que va a salir.
 *
 * Todo es `transform`, `opacity` y un `filter` estático por estado: nada que provoque layout por fotograma.
 */
import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";

/** Silueta con chaflán en el viewBox 100×140 (5/7): esquinas cortadas como el CardArt. */
const SHAPE = "M9 1 H91 L99 9 V131 L91 139 H9 L1 131 V9 Z";
const INNER = "M13 7 H87 L93 13 V127 L87 133 H13 L7 127 V13 Z";

export function CardBack({
  accent,
  className,
  charged = 0,
  chargeColor,
  pulse = true,
  style,
}: {
  /** Color del objeto del que salió la carta (el acento del sobre). */
  accent: string;
  /** El llamante trae la medida: `w-[92px]`, `w-full`… La proporción la pone la pieza. */
  className?: string;
  /** Carga de anticipación, 0-1. Enciende el canto y la luz interior. */
  charged?: number;
  /** Color de la carga. Por defecto, el del sobre. */
  chargeColor?: string;
  /** Respiración del sigilo. Se apaga sola con `prefers-reduced-motion`. */
  pulse?: boolean;
  style?: React.CSSProperties;
}) {
  const reduced = useReducedMotion();
  const carga = chargeColor ?? accent;
  const anima = pulse && !reduced;
  const uid = useId().replace(/:/g, "");
  const cargada = charged > 0;
  // La luz sigue la silueta: sombra física siempre, halo del color de la carga solo cuando se carga.
  const filter = cargada
    ? `drop-shadow(0 0 ${Math.round(6 + 16 * charged)}px ${carga}) drop-shadow(0 10px 16px rgba(0,0,0,0.6))`
    : "drop-shadow(0 10px 16px rgba(0,0,0,0.6))";

  return (
    <div className={cn("relative aspect-[5/7]", className)} style={{ filter, ...style }} data-card-back>
      <svg viewBox="0 0 100 140" className="absolute inset-0 h-full w-full" aria-hidden preserveAspectRatio="none">
        <defs>
          <linearGradient id={`${uid}-body`} x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0" stopColor="#1b1e30" />
            <stop offset="0.55" stopColor="#07080f" />
            <stop offset="1" stopColor="#12142a" />
          </linearGradient>
          <linearGradient id={`${uid}-edge`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={cargada ? carga : accent} stopOpacity="1" />
            <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="1" stopColor={cargada ? carga : accent} stopOpacity="0.9" />
          </linearGradient>
          <pattern id={`${uid}-foil`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(25)">
            <rect width="1.1" height="9" fill={accent} fillOpacity="0.16" />
          </pattern>
          <radialGradient id={`${uid}-core`} cx="0.5" cy="0.46" r="0.55">
            <stop offset="0" stopColor={accent} stopOpacity="0.32" />
            <stop offset="1" stopColor={accent} stopOpacity="0" />
          </radialGradient>
          {cargada && (
            <radialGradient id={`${uid}-charge`} cx="0.5" cy="1.05" r="0.9">
              <stop offset="0" stopColor={carga} stopOpacity={0.25 + charged * 0.55} />
              <stop offset="1" stopColor={carga} stopOpacity="0" />
            </radialGradient>
          )}
        </defs>
        <path d={SHAPE} fill={`url(#${uid}-body)`} />
        <path d={SHAPE} fill={`url(#${uid}-foil)`} />
        <path d={SHAPE} fill={`url(#${uid}-core)`} />
        {cargada && <path d={SHAPE} fill={`url(#${uid}-charge)`} />}
        {/* Filete exterior (luz del sobre o de la carga) y filete interior fino: la carta acuñada. */}
        <path d={SHAPE} fill="none" stroke={`url(#${uid}-edge)`} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        <path d={INNER} fill="none" stroke={accent} strokeOpacity="0.35" strokeWidth="0.6" />
        {/* Galones arriba y abajo: la geometría de la casa. */}
        <path d="M38 16 L50 22 L62 16" fill="none" stroke={accent} strokeOpacity="0.55" strokeWidth="1" />
        <path d="M38 124 L50 118 L62 124" fill="none" stroke={accent} strokeOpacity="0.55" strokeWidth="1" />
        <text x="50" y="106" textAnchor="middle" fontSize="7.2" letterSpacing="2.4" fill="#ffffff" fillOpacity="0.72" fontFamily="var(--font-display), system-ui, sans-serif" fontWeight="700">NEXUS</text>
      </svg>

      {/* El sigilo de NEXUS. Dimensionado en porcentaje: el mismo dorso sirve a 92 y a 300 px. */}
      <div className="relative grid h-full place-items-center">
        <motion.svg
          viewBox="0 0 100 100"
          className="h-[38%] w-[38%] -translate-y-[6%]"
          fill="none"
          aria-hidden
          animate={anima ? { scale: [1, 1.06, 1], opacity: [0.8, 1, 0.8] } : undefined}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <path d="M50 10 L84 30 L84 70 L50 90 L16 70 L16 30 Z" stroke={cargada ? carga : accent} strokeWidth="2.4" />
          <path d="M34 34 L52 50 L34 66 Z" fill={accent} fillOpacity="0.55" stroke={accent} strokeWidth="1.6" />
          <path d="M66 34 L48 50 L66 66 Z" fill={accent} fillOpacity="0.22" stroke={accent} strokeWidth="1.6" />
        </motion.svg>
      </div>
    </div>
  );
}
