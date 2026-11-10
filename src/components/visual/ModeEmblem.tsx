"use client";

/**
 * EMBLEMAS DE MODO DE JUEGO (Fase 9.5).
 *
 * Los cuatro modos del vestíbulo eran cuatro rectángulos con una etiqueta, un título y un
 * párrafo. Se leían como entradas de un índice, no como puertas a un modo de juego: nada
 * los distinguía salvo el color del degradado.
 *
 * Cada modo recibe aquí una marca geométrica propia que dice de un vistazo de qué va:
 *
 *   · DUELOS      — dos cuñas enfrentadas. Enfrentamiento directo.
 *   · TORNEOS     — un cuadro que asciende hacia una cúspide. Eliminatoria.
 *   · PICK'EMS    — una retícula sobre un punto. Puntería, predicción.
 *   · ENTRENADOR  — nodos unidos por líneas sobre una cuadrícula. Plan.
 *
 * Son formas geométricas ORIGINALES: ni assets, ni iconos de terceros, ni marcas de nadie.
 * Solo el vocabulario del género. SVG en línea, sin red y sin peticiones que fallen.
 */
import { cn } from "@/lib/format";

export type ModeId = "duelos" | "torneos" | "pickems" | "entrenador";

export function ModeEmblem({
  mode,
  color,
  className,
}: {
  mode: ModeId;
  /** Color de acento del modo, en `r, g, b`. */
  color: string;
  className?: string;
}) {
  const stroke = `rgb(${color})`;

  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("h-full w-full", className)}
      aria-hidden
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {mode === "duelos" && (
        <>
          {/* Dos cuñas que se enfrentan sin llegar a tocarse: la tensión del duelo. */}
          <path d="M6 14 L26 32 L6 50 Z" fill={stroke} fillOpacity="0.22" stroke={stroke} strokeWidth="2" />
          <path d="M58 14 L38 32 L58 50 Z" fill={stroke} fillOpacity="0.22" stroke={stroke} strokeWidth="2" />
          <line x1="32" y1="10" x2="32" y2="54" stroke={stroke} strokeWidth="1.5" strokeDasharray="3 4" opacity="0.7" />
        </>
      )}

      {mode === "torneos" && (
        <>
          {/* Cuadro de eliminatoria: cuatro entran, uno sube. */}
          <path d="M8 14 H20 V32 H32" stroke={stroke} strokeWidth="2" />
          <path d="M8 50 H20 V32" stroke={stroke} strokeWidth="2" />
          <path d="M56 14 H44 V32 H32" stroke={stroke} strokeWidth="2" />
          <path d="M56 50 H44 V32" stroke={stroke} strokeWidth="2" />
          <polygon points="32,20 39,32 32,44 25,32" fill={stroke} fillOpacity="0.3" stroke={stroke} strokeWidth="2" />
        </>
      )}

      {mode === "pickems" && (
        <>
          {/* Retícula: acertar. */}
          <circle cx="32" cy="32" r="20" stroke={stroke} strokeWidth="2" opacity="0.85" />
          <circle cx="32" cy="32" r="10" stroke={stroke} strokeWidth="1.5" opacity="0.6" />
          <circle cx="32" cy="32" r="3.5" fill={stroke} />
          <path d="M32 4 V13 M32 51 V60 M4 32 H13 M51 32 H60" stroke={stroke} strokeWidth="2" />
        </>
      )}

      {mode === "entrenador" && (
        <>
          {/* Cuadrícula de pizarra con cinco posiciones y sus líneas. */}
          <rect x="7" y="9" width="50" height="46" rx="3" stroke={stroke} strokeWidth="1.6" opacity="0.55" />
          <path d="M7 24 H57 M7 40 H57 M23 9 V55 M41 9 V55" stroke={stroke} strokeWidth="0.8" opacity="0.28" />
          <path d="M16 44 L30 30 L44 36 L50 20" stroke={stroke} strokeWidth="2" strokeDasharray="4 3" />
          <circle cx="16" cy="44" r="4" fill={stroke} fillOpacity="0.85" />
          <circle cx="30" cy="30" r="4" fill={stroke} fillOpacity="0.7" />
          <circle cx="44" cy="36" r="4" fill={stroke} fillOpacity="0.55" />
          <circle cx="50" cy="20" r="4" fill={stroke} fillOpacity="0.4" />
        </>
      )}
    </svg>
  );
}
