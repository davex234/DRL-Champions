"use client";

/**
 * FASE 43 · IMPACTO DE UN CAMBIO — antes → después de las medias (exactas), identidad y balance, y frases de encaje.
 * Lo usan la vista previa del constructor y la comparación informativa con cartas que no posees.
 */
import type { SwapImpact } from "@/domain/deckStrategy";
import { fmt1, impactLines } from "@/lib/deckStrategy/presentation";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

export function StrategyImpact({ impact, informative = false }: { impact: SwapImpact; informative?: boolean }) {
  useLocale();
  return (
    <div className="mt-5 rounded-xl border border-drl-cyan/25 bg-drl-cyan/[0.04] p-3" data-testid="strategy-impact" data-informative={informative}>
      <p className="nx-label !text-drl-cyan">{informative ? t("Si la tuvieras (solo informativo)") : t("Qué cambia en tu equipo")}</p>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {impactLines(impact).map((l) => (
          <li key={l.metric} aria-label={td(l.aria)} className="flex items-baseline justify-between gap-2 rounded-lg bg-black/25 px-2.5 py-1.5 text-[13px]">
            <span aria-hidden className="font-display font-bold uppercase tracking-wide text-white/85">{td(l.label)}</span>
            <span aria-hidden className="tabular-nums text-white">{td(l.before)} → <b className="nx-readout">{td(l.after)}</b> <span className={l.delta.startsWith("+") ? "text-ok" : l.delta.startsWith("−") ? "text-bad" : "text-ink-faint"}>({td(l.delta)})</span></span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12.5px] text-white" data-testid="impact-identity">
        {impact.orientationBefore && impact.orientationAfter
          ? impact.identityChanged ? t("Perfil: «{label}» → «{label2}».", { label: td(impact.orientationBefore.label), label2: td(impact.orientationAfter.label) }) : t("Perfil: se mantiene «{label}».", { label: td(impact.orientationAfter.label) })
          : t("Perfil: se calcula con el equipo completo (10 cartas).")}
        {impact.spreadBefore !== null && impact.spreadAfter !== null && t(" Distancia entre ejes: {spreadBefore} σ → {spreadAfter} σ.", { spreadBefore: fmt1(impact.spreadBefore), spreadAfter: fmt1(impact.spreadAfter) })}
      </p>
      <ul className="mt-1.5 space-y-0.5 text-[12px] text-ink-secondary" data-testid="impact-fit">
        {impact.fit.map((f) => <li key={f}>· {td(f)}</li>)}
      </ul>
      {impact.noChange && <p className="mt-1 text-[12px] text-ink-muted">{t("Sin cambios en las medias del equipo.")}</p>}
    </div>
  );
}
