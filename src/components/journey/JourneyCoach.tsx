"use client";

/**
 * PLAYER JOURNEY · COACH CONTEXTUAL (Fase 40). UN bloque pequeño dentro de la pantalla real (colección, constructor,
 * pre-partida). Nunca flota sobre la mano ni los botones, no es un modal y no habla como un personaje: solo explica lo
 * que el jugador tiene delante.
 */
import { cn } from "@/lib/format";

export function JourneyCoach({ eyebrow, title, children, className, testId = "journey-coach" }: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <aside aria-label={title} data-testid={testId} className={cn("nx-clip-sm border border-drl/35 border-l-2 border-l-drl bg-drl/[0.05] px-4 py-3", className)}>
      <p className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-drl-glow">{eyebrow}</p>
      <p className="mt-0.5 font-display text-[17px] font-bold uppercase leading-tight text-white">{title}</p>
      <div className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">{children}</div>
    </aside>
  );
}
