"use client";

/**
 * FASE 43 · TU EQUIPO ANTES DE JUGAR — perfil compacto del PROPIO equipo (orientación, tres ejes, una fortaleza, un
 * punto flojo). Recibe SOLO tus cartas: del rival no hay nada que analizar antes de que juegue (PvE incluido: su mazo
 * se construye en el servidor al empezar y sus cartas no jugadas nunca salen de él).
 */
import { useMemo } from "react";
import { cn } from "@/lib/format";
import { analyzeDeck } from "@/domain/deckStrategy";
import type { DuelDeckCardDTO } from "@/lib/duel/types";
import { strategyContext } from "@/lib/deckStrategy/catalog";
import { dtoToStrategy } from "@/lib/deckStrategy/presentation";
import { AxisBars, IdentityBadge } from "./StrategyLabPanel";

export function PreMatchStrategy({ cards, className }: { cards: DuelDeckCardDTO[]; className?: string }) {
  const a = useMemo(() => analyzeDeck(cards.map(dtoToStrategy), strategyContext()), [cards]);
  if (!a.complete) return null;
  return (
    <section aria-label="Perfil de tu equipo" className={cn("nx-clip-sm border border-drl-cyan/25 bg-drl-cyan/[0.04] px-4 py-3", className)} data-testid="prematch-strategy">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="nx-label">Perfil de tu equipo</span>
        <IdentityBadge analysis={a} />
      </div>
      <div className="mt-2"><AxisBars analysis={a} compact /></div>
      <div className="mt-2 grid gap-1 text-[12px] sm:grid-cols-2">
        {a.strengths[0] && <p className="text-white"><span aria-hidden className="mr-1 text-ok">▲</span><span className="sr-only">Fortaleza: </span>{a.strengths[0].text}</p>}
        {a.weaknesses[0] && <p className="text-white"><span aria-hidden className="mr-1 text-drl-gold">▼</span><span className="sr-only">Punto flojo: </span>{a.weaknesses[0].text}</p>}
      </div>
      <p className="mt-1.5 text-[11px] text-ink-faint">Solo tu equipo. Del rival no se sabe nada hasta que juega cada carta.</p>
    </section>
  );
}
