"use client";

/**
 * PIZARRA TÁCTICA — construir un plan PASO A PASO (no dibujo libre). El entrenador
 * encadena pasos (Split A → Dos Mid → Lurk → Flash → Smoke → Execute → Post Plant) y la
 * pizarra los compila a una orden que el Director ejecuta (`compileChalkboard`). Emite el
 * plan compilado; el panel táctico lo traduce a su decisión.
 */
import { useMemo, useState } from "react";
import { compileChalkboard, type ChalkStep, type ChalkStepKind, type ChalkboardPlan } from "@/coach";
import type { Lane } from "@/tactics";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("coach");

const INTENT_STEPS: { kind: ChalkStepKind; label: string; lane?: boolean }[] = [
  { kind: "default", label: "Default" }, { kind: "split", label: "Split", lane: true },
  { kind: "stack", label: "Stack", lane: true }, { kind: "fake", label: "Fake" },
  { kind: "execute", label: "Execute", lane: true }, { kind: "rush", label: "Rush", lane: true },
  { kind: "lurk", label: "Lurk", lane: true }, { kind: "retake", label: "Retake" }, { kind: "save", label: "Save" },
];
const UTIL_STEPS: { kind: ChalkStepKind; label: string }[] = [
  { kind: "flash", label: "Flash" }, { kind: "smoke", label: "Smoke" }, { kind: "recon", label: "Recon" }, { kind: "molly", label: "Molly" }, { kind: "post_plant", label: "Post-plant" },
];
const LANES: { id: Lane; label: string }[] = [{ id: "main", label: "A" }, { id: "mid", label: "Mid" }, { id: "tree", label: "B" }];

export function ChalkboardBuilder({ onApply }: { onApply: (plan: ChalkboardPlan) => void }) {
  useLocale();
  const [steps, setSteps] = useState<ChalkStep[]>([]);
  const [lane, setLane] = useState<Lane>("main");
  const plan = useMemo(() => compileChalkboard(steps), [steps]);

  const add = (kind: ChalkStepKind, withLane: boolean) =>
    setSteps((s) => [...s, withLane ? { kind, lane } : { kind }]);

  return (
    <div className="rounded-2xl border border-white/10 bg-base-700/30 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-display text-[11px] uppercase tracking-widest text-white/45">{t("Pizarra táctica")}</p>
        <div className="flex gap-1">
          {LANES.map((l) => (
            <button key={l.id} onClick={() => setLane(l.id)}
              className={cn("rounded px-2 py-0.5 font-display text-[10px] uppercase transition", lane === l.id ? "bg-drl text-white" : "border border-white/10 text-white/50")}>
              {td(l.label)}
            </button>
          ))}
        </div>
      </div>

      {/* Secuencia construida */}
      <div className="mb-2 flex min-h-[2rem] flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-base-900/40 p-2">
        {steps.length === 0 ? (
          <span className="text-[11px] text-white/30">{t("Encadena pasos para construir el plan…")}</span>
        ) : steps.map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-white/25">→</span>}
            <span className="rounded-md border border-drl/30 bg-drl/10 px-2 py-0.5 font-display text-[10px] uppercase tracking-wide text-drl">
              {s.kind}{s.lane ? ` ${s.lane}` : ""}
            </span>
          </span>
        ))}
        {steps.length > 0 && (
          <button onClick={() => setSteps((s) => s.slice(0, -1))} className="ml-1 text-[11px] text-white/40 hover:text-white/70">↶</button>
        )}
      </div>

      {/* Paletas */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-1">
          {INTENT_STEPS.map((st) => (
            <button key={st.kind} onClick={() => add(st.kind, !!st.lane)}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1 font-display text-[10px] uppercase tracking-wide text-white/70 transition hover:bg-white/15">
              {td(st.label)}{st.lane ? ` ${lane}` : ""}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {UTIL_STEPS.map((st) => (
            <button key={st.kind} onClick={() => add(st.kind, false)}
              className="rounded-md border border-cyan-400/20 bg-cyan-400/5 px-2 py-1 font-display text-[10px] uppercase tracking-wide text-cyan-200/80 transition hover:bg-cyan-400/15">
              {td(st.label)}
            </button>
          ))}
        </div>
      </div>

      {/* Compilado */}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-2">
        <p className="text-[11px] text-white/55">{plan.valid ? td(plan.summary) : t("Plan incompleto")}</p>
        <button onClick={() => plan.valid && onApply(plan)} disabled={!plan.valid}
          className="shrink-0 rounded-lg border border-drl/40 bg-drl/15 px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide text-drl transition enabled:hover:bg-drl/25 disabled:opacity-30">
          {t("Usar pizarra ▸")}
        </button>
      </div>
    </div>
  );
}
