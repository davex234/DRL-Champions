"use client";

/**
 * FASE 43 · LABORATORIO DE EQUIPO — la lectura estratégica del borrador, en vivo.
 *
 * El panel muestra solo IDENTIDAD (etiqueta de perfil) y la frase de balance. `AxisBars` se sigue exportando
 * para la preparación de partida.
 * Todo sale de `analyzeDeck` (dominio puro): descriptivo, sin «puntuación de estrategia», sin predicción.
 */
import { cn } from "@/lib/format";
import { type Axis, type DeckAnalysis } from "@/domain/deckStrategy";
import { AXIS_COLOR, axisRows, identityModel } from "@/lib/deckStrategy/presentation";
import { ns, td as i18nTd } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

export function IdentityBadge({ analysis, className }: { analysis: DeckAnalysis; className?: string }) {
  useLocale();
  const id = identityModel(analysis);
  const tone = id.kind === "ORIENTED" ? "border-drl-cyan/60 text-drl-cyan" : id.kind === "BALANCED" ? "border-ok/60 text-ok" : id.kind === "MIXED" ? "border-drl-gold/60 text-drl-gold" : "border-white/20 text-white/70";
  return (
    <span data-testid="deck-orientation" data-kind={id.kind} className={cn("inline-flex min-h-[28px] items-center rounded-full border px-2.5 font-display text-[12px] font-bold uppercase tracking-[0.1em]", tone, className)}>
      {i18nTd(id.label)}{id.shape ? ` · ${id.shape}` : ""}
    </span>
  );
}

export function AxisBars({ analysis, compact = false }: { analysis: DeckAnalysis; compact?: boolean }) {
  useLocale();
  const rows = axisRows(analysis).filter((r) => !compact || r.metric !== "ovr");
  return (
    <ul className={cn("space-y-2.5", compact && "space-y-1.5")} data-testid="axis-bars">
      {rows.map((r) => (
        <li key={r.metric} aria-label={i18nTd(r.aria)} data-metric={r.metric}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-[12px] font-bold uppercase tracking-[0.12em] text-white/85">{i18nTd(r.label)}</span>
            <span className="flex items-baseline gap-2">
              <b className="nx-readout text-[20px] tabular-nums text-white">{i18nTd(r.valueText)}</b>
              {r.level && <span className="text-[11px] font-semibold uppercase text-ink-secondary">{i18nTd(r.level)} · {i18nTd(r.percentile)}</span>}
            </span>
          </div>
          <span aria-hidden className="mt-1 block h-2 overflow-hidden rounded-full bg-white/10">
            <span className="block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.round(r.bar)}%`, background: r.metric === "ovr" ? "rgba(255,255,255,0.55)" : AXIS_COLOR[r.metric as Axis] }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface StrategyLabPanelProps {
  analysis: DeckAnalysis;
  className?: string;
}

/** Versión reducida: solo encabezado, etiqueta de perfil y la frase de balance (o el aviso de equipo incompleto). */
export function StrategyLabPanel({ analysis: a, className }: StrategyLabPanelProps) {
  useLocale();
  const id = identityModel(a);
  return (
    <section aria-labelledby="lab-title" className={cn("nx-clip relative overflow-hidden border border-drl-cyan/25 bg-[linear-gradient(165deg,rgba(63,210,255,0.08),rgba(8,10,18,0.9)_45%)] p-4", className)} data-testid="strategy-lab" data-complete={a.complete}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="lab-title" className="nx-label !text-drl-cyan">{t("Laboratorio de equipo")}</h2>
        <IdentityBadge analysis={a} />
      </div>
      {id.balance && <p className="mt-2 text-[13.5px] font-semibold leading-snug text-white" data-testid="deck-balance">{i18nTd(id.balance)}</p>}
      {id.partial && <p className="mt-2 text-caption text-ink-muted">{i18nTd(id.partial)}</p>}
    </section>
  );
}
