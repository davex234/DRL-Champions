"use client";

/**
 * [ FASE DE GRUPOS ] [ PLAYOFFS ] (Fase 24.3) — solo cuando los datos separan las dos fases.
 */
import { cn } from "@/lib/format";
import type { BracketStage } from "@/domain/pickems/bracket";

export function BracketStageTabs({
  stages, selected, onSelect, className,
}: {
  stages: BracketStage[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
}) {
  if (stages.length < 2) return null;
  return (
    <div role="group" aria-label="Fases del torneo" className={cn("flex flex-wrap gap-2", className)}>
      {stages.map((s) => {
        const on = s.id === selected;
        return (
          <button
            key={s.id ?? "sin-fase"}
            type="button"
            onClick={() => onSelect(s.id)}
            aria-pressed={on}
            className={cn(
              "nx-clip-sm nx-focus min-h-[44px] px-4 font-display text-[12px] font-bold uppercase tracking-[0.16em] transition duration-fast motion-reduce:transition-none",
              on ? "bg-drl/15 text-white" : "bg-white/[0.04] text-ink-secondary hover:bg-white/[0.08]",
            )}
            style={{ boxShadow: on ? "inset 0 0 0 1.5px var(--nx-accent)" : "inset 0 0 0 1px rgba(255,255,255,0.12)" }}
          >
            {s.name}
            <span className="nx-label ml-2">{s.bracket ? "cuadro" : "liga"}</span>
          </button>
        );
      })}
    </div>
  );
}
