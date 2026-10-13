"use client";

/**
 * FASE 44 · CARGADOR DE JUEGO — sustituye al spinner genérico.
 *
 * La marca NEXUS dentro de un hexágono que gira despacio y cuatro barras de carga que se encienden en cadena. Sin
 * porcentaje (no hay progreso real que medir), con la frase REAL de lo que se está haciendo («Preparando duelo…») y
 * un consejo opcional que tiene que ser verdad. `role="status"`: el lector de pantalla oye lo mismo que se ve.
 * Con movimiento reducido todo queda quieto y la frase sigue ahí.
 */
import { BrandMark } from "@/branding/Logo";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("ui");

export function GameLoader({
  label = t("Cargando…"), tip, className, compact = false,
}: {
  label?: string;
  /** Consejo corto y verdadero sobre el juego. Opcional. */
  tip?: string;
  className?: string;
  compact?: boolean;
}) {
  useLocale();
  return (
    <div
      className={cn("grid place-items-center", compact ? "min-h-[18vh] py-6" : "min-h-[46vh] py-10", className)}
      role="status"
      aria-live="polite"
      data-testid="game-loader"
      data-motion-level="2"
    >
      <div className="flex flex-col items-center gap-5 text-center">
        <span className="nx-loader-mark">
          <span aria-hidden className="nx-loader-ring" />
          <BrandMark size={compact ? 40 : 56} className="relative drop-shadow-[0_0_18px_rgba(255,46,99,0.45)]" title={t("NEXUS")} />
        </span>
        <span aria-hidden className="nx-loader-bars"><i /><i /><i /><i /></span>
        <p className="font-display text-[15px] font-bold uppercase tracking-[0.18em] text-white/80">{td(label)}</p>
        {tip && <p className="max-w-sm text-[13px] leading-relaxed text-white/50"><span className="nx-label mr-2 !text-white/40">{t("Consejo")}</span>{td(tip)}</p>}
      </div>
    </div>
  );
}
