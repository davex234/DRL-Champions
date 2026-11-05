"use client";

/**
 * FASE 44 · GAME CTA — el botón JUGAR.
 *
 * No es un enlace de la barra: es la acción del juego. Tres tamaños con la MISMA pieza (`bar` en la barra superior,
 * `hero` en el vestíbulo, `dock` en el centro del dock móvil). El texto sale de `playCta` (JUGAR / CONTINUAR
 * PARTIDA según el servidor). Movimiento: barrido de luz lento en reposo (el único bucle del armazón), elevación
 * al apuntar, hundimiento al pulsar; con movimiento reducido, nada se mueve y el estado se sigue leyendo.
 */
import Link from "next/link";
import { cn } from "@/lib/format";
import type { PlayCta } from "@/design/gameShell";
import { playSound } from "@/lib/sound";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("ui");

export type PlayButtonSize = "bar" | "hero" | "dock";

export function PlayButton({
  cta, size = "bar", className, onClick, testId = "play-cta",
}: {
  cta: PlayCta;
  size?: PlayButtonSize;
  className?: string;
  onClick?: () => void;
  testId?: string;
}) {
  useLocale();
  return (
    <span className={cn("nx-play-wrap inline-flex", className)}>
      <span aria-hidden className="nx-play-halo" />
      <Link
        href={cta.href}
        onClick={() => { playSound("play.confirm"); onClick?.(); }}
        onMouseEnter={() => playSound("play.hover")}
        className="nx-play"
        data-size={size}
        data-kind={cta.kind}
        data-game-cta="play"
        data-cta="primary"
        data-motion-level="1"
        data-testid={testId}
        aria-label={td(cta.ariaLabel)}
      >
        {size === "dock" ? (
          <>
            <PlayGlyph className="h-5 w-5" />
            <span>{cta.kind === "resume" ? t("Seguir") : td(cta.label)}</span>
          </>
        ) : (
          <>
            <span className="flex flex-col items-start">
              <span>{td(cta.label)}</span>
              {size === "hero" && cta.hint && <span className="nx-play-hint">{td(cta.hint)}</span>}
            </span>
            <PlayGlyph className={cn("nx-play-icon", size === "hero" ? "h-7 w-7" : "h-4 w-4")} />
          </>
        )}
      </Link>
    </span>
  );
}

/** Flecha de acción: triángulo con corte a 45°, trazo de la casa. */
export function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M6 3.5 20 12 6 20.5V15l5-3-5-3z" />
    </svg>
  );
}
