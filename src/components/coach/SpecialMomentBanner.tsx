"use client";

/**
 * MOMENTOS ESPECIALES — el entrenador REACCIONA a los puntos de inflexión (match point,
 * eco, racha, momentum, cambio de lado, ACE). Cada momento ofrece DECISIONES: las
 * órdenes (command) se aplican en vivo; los conceptos quedan como sugerencia para la
 * sala táctica. Consume `SpecialMoment[]` (puro).
 */
import type { SpecialMoment } from "@/lib/match/special";
import type { CoachCommandId } from "@/coach";
import { cn } from "@/lib/format";
import { td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const TONE: Record<SpecialMoment["tone"], string> = {
  go: "border-emerald-400/50 bg-emerald-500/10",
  danger: "border-rose-400/50 bg-rose-500/10",
  info: "border-cyan-400/40 bg-cyan-400/5",
  calm: "border-white/20 bg-white/5",
};

export function SpecialMomentBanner({ moments, onCommand }: {
  moments: SpecialMoment[]; onCommand?: (id: CoachCommandId) => void;
}) {
  useLocale();
  if (moments.length === 0) return null;
  // El más relevante primero (match point / momentum mandan).
  const m = moments[0];
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5", TONE[m.tone])}>
      <span className="font-display text-sm font-black uppercase tracking-[0.2em] text-white">{td(m.title)}</span>
      <span className="flex-1 text-[12px] text-white/70">{td(m.message)}</span>
      <div className="flex flex-wrap gap-1.5">
        {m.options.map((o, i) =>
          o.kind === "command" && onCommand ? (
            <button key={i} onClick={() => onCommand(o.id as CoachCommandId)}
              className="rounded-md border border-white/25 bg-white/10 px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-wide text-white transition hover:bg-white/20">
              {td(o.label)}
            </button>
          ) : (
            <span key={i} className="rounded-md border border-white/15 px-2.5 py-1 font-display text-[10px] uppercase tracking-wide text-white/55">
              {td(o.label)}
            </span>
          )
        )}
      </div>
    </div>
  );
}
