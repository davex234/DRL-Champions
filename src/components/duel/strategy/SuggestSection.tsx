"use client";

/**
 * FASE 43 · PLANTILLA POR OBJETIVO — «hazme una plantilla orientada a Stronghold», nunca «el mejor equipo».
 *
 * Cuatro objetivos explícitos (Equilibrado, Priorizar Stronghold / Gamesense / Entryfrag) y, aparte, las opciones
 * no dominadas. Se calcula con tus cartas y sin red; «Aplicar al borrador» cambia el borrador, NO guarda.
 */
import { useMemo, useState } from "react";
import { cn } from "@/lib/format";
import { OBJECTIVES, OBJECTIVE_LABEL, paretoOptions, suggestDeck, type ParetoOption, type SuggestObjective, type Suggestion } from "@/domain/deckStrategy";
import type { Pool } from "@/domain/deckBuilder/builder";
import { strategyContext } from "@/lib/deckStrategy/catalog";
import { fmt1 } from "@/lib/deckStrategy/presentation";
import { IdentityBadge } from "./StrategyLabPanel";

export interface SuggestSectionProps {
  pool: Pool;
  currentUids: readonly string[];
  onApply: (uids: string[], label: string) => void;
  /** Arnés QA: objetivo ya calculado / opciones desplegadas. */
  initialObjective?: SuggestObjective | null;
  initialPareto?: boolean;
}

const changes = (a: readonly string[], b: readonly string[]) => b.filter((u) => !a.includes(u)).length;
const means = (t: { ovr: number; stronghold: number; gamesense: number; entryfrag: number }) => `OVR ${fmt1(t.ovr / 10)} · SH ${fmt1(t.stronghold / 10)} · GS ${fmt1(t.gamesense / 10)} · EF ${fmt1(t.entryfrag / 10)}`;

export function SuggestSection({ pool, currentUids, onApply, initialObjective = null, initialPareto = false }: SuggestSectionProps) {
  const [objective, setObjective] = useState<SuggestObjective | null>(initialObjective);
  const [pareto, setPareto] = useState(initialPareto);
  const ctx = strategyContext();
  const result: Suggestion | null = useMemo(() => (objective ? suggestDeck(pool, objective, ctx) : null), [objective, pool, ctx]);
  const options: ParetoOption[] = useMemo(() => (pareto ? paretoOptions(pool, ctx) : []), [pareto, pool, ctx]);

  return (
    <section aria-labelledby="suggest-title" className="nx-clip border border-white/10 bg-white/[0.03] p-4" data-testid="suggest-objective">
      <h2 id="suggest-title" className="nx-label">Equipo por objetivo</h2>
      <p className="mt-1 text-caption text-ink-muted">Con tus cartas y las reglas del juego. No existe «el mejor equipo»: eliges qué priorizar.</p>
      <div className="mt-2 grid grid-cols-2 gap-1.5" role="group" aria-label="Objetivo">
        {OBJECTIVES.map((o) => (
          <button key={o} type="button" aria-pressed={objective === o} onClick={() => setObjective(o)} data-objective={o}
            className={cn("nx-focus min-h-[44px] rounded-control border px-2 text-[11.5px] font-bold uppercase tracking-wide", objective === o ? "border-drl-cyan bg-drl-cyan/15 text-white" : "border-white/15 text-white/75 hover:bg-white/5")}>
            {OBJECTIVE_LABEL[o]}
          </button>
        ))}
      </div>
      {result && (
        <div role="status" className={cn("mt-3 rounded-lg border px-3 py-2.5", result.ok ? "border-drl-cyan/35 bg-drl-cyan/[0.06]" : "border-bad/40 bg-bad/[0.07]")} data-testid="suggest-result" data-ok={result.ok}>
          {result.ok && result.analysis && result.totals ? (
            <>
              <div className="flex flex-wrap items-center gap-2"><IdentityBadge analysis={result.analysis} /><span className="text-[12px] text-white/80">{changes(currentUids, result.uids)} {changes(currentUids, result.uids) === 1 ? "cambio" : "cambios"} sobre tu borrador</span></div>
              <p className="mt-1.5 text-[12.5px] tabular-nums text-white">{means(result.totals)}</p>
              <p className="mt-1 text-[11px] text-ink-faint">Regla: {result.rule}</p>
              <button type="button" onClick={() => onApply(result.uids, OBJECTIVE_LABEL[result.objective])} disabled={changes(currentUids, result.uids) === 0 && currentUids.length === 10}
                className="nx-focus mt-2 min-h-[44px] w-full rounded-control bg-drl-cyan/90 px-3 text-[12px] font-bold uppercase tracking-wide text-black disabled:opacity-50" data-testid="suggest-apply">
                Aplicar al borrador (sin guardar)
              </button>
            </>
          ) : <p className="text-[12.5px] text-white">{result.reason}</p>}
        </div>
      )}
      <button type="button" onClick={() => setPareto((v) => !v)} aria-expanded={pareto} className="nx-focus mt-3 min-h-[44px] w-full rounded-control border border-white/12 text-[11.5px] font-bold uppercase tracking-wide text-white/75 hover:bg-white/5" data-testid="pareto-toggle">
        {pareto ? "Ocultar opciones" : "Ver opciones no dominadas"}
      </button>
      {pareto && (
        <ul className="mt-2 space-y-1.5" data-testid="pareto-options" data-count={options.length}>
          {options.map((o) => (
            <li key={o.uids.join(",")} className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
              <p className="font-display text-[12px] font-bold uppercase tracking-wide text-white">{o.labels.join(" · ")}</p>
              <p className="text-[11.5px] tabular-nums text-ink-secondary">{means(o.totals)}</p>
              <button type="button" onClick={() => onApply(o.uids, o.labels[0])} className="nx-action mt-1 min-h-[44px] text-[11px]">Aplicar al borrador</button>
            </li>
          ))}
          <li className="text-[11px] text-ink-faint">Ninguna opción supera a otra en todo: cada una gana en algo.</li>
        </ul>
      )}
    </section>
  );
}
