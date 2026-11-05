"use client";

/**
 * MEDIDOR — la barra de progreso del sistema.
 *
 * ────────────────────────── POR QUÉ ──────────────────────────
 *
 * Es el componente más reescrito del producto: hay una barra en el pase, otra en la maestría,
 * otra en los logros, otra en el evento, otra en el prestigio y otra en el launcher. Todas
 * hacen lo mismo y ninguna se parece: unas animan `width` (que reflowa en cada tick), otras
 * llevan `rounded-full`, cada una elige su altura y su color.
 *
 * Dos decisiones que esta versión fija para todas:
 *
 *  1. Se anima `transform: scaleX`, nunca `width`. Una barra que avanza cuatro veces por
 *     segundo mientras se descarga un juego no puede recalcular el layout en cada paso.
 *  2. El hueco es una superficie HUNDIDA de verdad (`RECESSED`), no un `bg-black/60` a ojo:
 *     una barra es un canal excavado con algo dentro.
 *
 * `data-progress` publica el valor exacto porque `aria-valuenow` va redondeado y un 0,14 % de
 * una descarga de 22 GB se leería como «no avanza».
 */
import { RECESSED } from "@/design/tokens";
import { cn } from "@/lib/format";
import { TONE, type Tone } from "./tone";
import { td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

export function Meter({
  value, tone = "key", height = 8, striped, label, className,
}: {
  /** 0..100. Se recorta al rango: un progreso imposible no rompe la barra. */
  value: number;
  tone?: Tone;
  height?: number;
  /** Barrido de luz. Solo mientras algo avanza de verdad. */
  striped?: boolean;
  /** Etiqueta accesible cuando la barra no va acompañada de texto. */
  label?: string;
  className?: string;
}) {
  useLocale();
  const color = TONE[tone];
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-full", className)}
      style={{ height, background: "rgba(0,0,0,0.55)", boxShadow: RECESSED.sm }}
      role="progressbar"
      aria-label={td(label)}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      data-progress={pct.toFixed(3)}
    >
      <div
        className="h-full w-full origin-left rounded-full transition-transform duration-normal ease-out"
        style={{
          transform: `scaleX(${pct / 100})`,
          background: `linear-gradient(90deg, ${color}90, ${color})`,
          boxShadow: `0 0 14px ${color}80`,
        }}
      />
      {striped && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-shimmer opacity-30"
          style={{
            backgroundImage: "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.55) 50%, transparent 70%)",
            backgroundSize: "200% 100%",
          }}
        />
      )}
    </div>
  );
}
