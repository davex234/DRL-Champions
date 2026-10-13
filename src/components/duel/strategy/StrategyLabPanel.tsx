"use client";

/**
 * FASE 43 · LABORATORIO DE EQUIPO — la lectura estratégica del borrador, en vivo.
 *
 * Jerarquía (sin 40 métricas de golpe): IDENTIDAD → los tres EJES (+ OVR) con percentil y nivel → hasta 3
 * FORTALEZAS y 3 PUNTOS FLOJOS → ROLES → detalles avanzados plegados (mediana, rango, dispersión, percentil).
 * Todo sale de `analyzeDeck` (dominio puro): descriptivo, sin «puntuación de estrategia», sin predicción.
 */
import { cn } from "@/lib/format";
import { METRIC_LABEL, METRICS, type Axis, type DeckAnalysis } from "@/domain/deckStrategy";
import { AXIS_COLOR, axisRows, fmt1, identityModel, pLabel } from "@/lib/deckStrategy/presentation";

const ROLE_SHORT: Record<string, string> = { Duelista: "Duelistas", Iniciador: "Iniciadores", Controlador: "Controladores", Centinela: "Centinelas", Flex: "Flex" };

export function IdentityBadge({ analysis, className }: { analysis: DeckAnalysis; className?: string }) {
  const id = identityModel(analysis);
  const tone = id.kind === "ORIENTED" ? "border-drl-cyan/60 text-drl-cyan" : id.kind === "BALANCED" ? "border-ok/60 text-ok" : id.kind === "MIXED" ? "border-drl-gold/60 text-drl-gold" : "border-white/20 text-white/70";
  return (
    <span data-testid="deck-orientation" data-kind={id.kind} className={cn("inline-flex min-h-[28px] items-center rounded-full border px-2.5 font-display text-[12px] font-bold uppercase tracking-[0.1em]", tone, className)}>
      {id.label}{id.shape ? ` · ${id.shape}` : ""}
    </span>
  );
}

export function AxisBars({ analysis, compact = false }: { analysis: DeckAnalysis; compact?: boolean }) {
  const rows = axisRows(analysis).filter((r) => !compact || r.metric !== "ovr");
  return (
    <ul className={cn("space-y-2.5", compact && "space-y-1.5")} data-testid="axis-bars">
      {rows.map((r) => (
        <li key={r.metric} aria-label={r.aria} data-metric={r.metric}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-[12px] font-bold uppercase tracking-[0.12em] text-white/85">{r.label}</span>
            <span className="flex items-baseline gap-2">
              <b className="nx-readout text-[20px] tabular-nums text-white">{r.valueText}</b>
              {r.level && <span className="text-[11px] font-semibold uppercase text-ink-secondary">{r.level} · {r.percentile}</span>}
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
  /** Eje de contexto que llega desde el resumen de una partida (nunca una orden). */
  contextAxis?: Axis | null;
  onDismissContext?: () => void;
  onFocusCard?: (uid: string) => void;
  className?: string;
}

export function StrategyLabPanel({ analysis: a, contextAxis = null, onDismissContext, onFocusCard, className }: StrategyLabPanelProps) {
  const id = identityModel(a);
  return (
    <section aria-labelledby="lab-title" className={cn("nx-clip relative overflow-hidden border border-drl-cyan/25 bg-[linear-gradient(165deg,rgba(63,210,255,0.08),rgba(8,10,18,0.9)_45%)] p-4", className)} data-testid="strategy-lab" data-complete={a.complete}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="lab-title" className="nx-label !text-drl-cyan">Laboratorio de equipo</h2>
        <IdentityBadge analysis={a} />
      </div>
      {id.balance && <p className="mt-2 text-[13.5px] font-semibold leading-snug text-white" data-testid="deck-balance">{id.balance}</p>}
      {id.partial && <p className="mt-2 text-caption text-ink-muted">{id.partial}</p>}

      {contextAxis && (
        <div role="note" className="nx-clip-sm mt-3 flex flex-wrap items-center gap-2 border border-drl-gold/40 bg-drl-gold/[0.07] px-3 py-2" data-testid="lab-context">
          <span className="text-[12px] text-white">Contexto de tu última partida: <b>{METRIC_LABEL[contextAxis]}</b>. Las alternativas se ordenan por ese eje; no es una recomendación.</span>
          {onDismissContext && <button type="button" onClick={onDismissContext} className="nx-action ml-auto min-h-[44px]">Quitar contexto</button>}
        </div>
      )}

      {a.count > 0 && <div className="mt-3"><AxisBars analysis={a} /></div>}
      {a.complete && <p className="mt-1.5 text-[11px] text-ink-faint">Percentil de cada media frente a las cartas del catálogo. La orientación se mide frente a 20.000 equipos legales simulados.</p>}

      {(a.strengths.length > 0 || a.weaknesses.length > 0) && (
        <div className="mt-3 grid gap-2">
          {a.strengths.length > 0 && (
            <div className="nx-clip-sm border border-ok/30 bg-ok/[0.06] px-3 py-2" data-testid="lab-strengths">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ok">Fuerte en</p>
              <ul className="mt-1 space-y-1">{a.strengths.map((s) => <li key={s.id} className="text-[12.5px] leading-snug text-white"><span aria-hidden className="mr-1.5 text-ok">▲</span>{s.text}</li>)}</ul>
            </div>
          )}
          {a.weaknesses.length > 0 && (
            <div className="nx-clip-sm border border-drl-gold/30 bg-drl-gold/[0.06] px-3 py-2" data-testid="lab-weaknesses">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-drl-gold">Flojo en</p>
              <ul className="mt-1 space-y-1">
                {a.weaknesses.map((w) => (
                  <li key={w.id} className="flex items-start gap-1.5 text-[12.5px] leading-snug text-white">
                    <span aria-hidden className="text-drl-gold">▼</span>
                    <span className="min-w-0 flex-1">{w.text}</span>
                    {onFocusCard && w.uids?.[0] && <button type="button" onClick={() => onFocusCard(w.uids![0])} className="nx-action shrink-0 min-h-[44px] text-[11px]">Ver carta</button>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {a.count > 0 && (
        <table className="mt-3 w-full text-left text-[12px]" data-testid="lab-roles">
          <caption className="nx-label mb-1 text-left">Por rol</caption>
          <thead><tr className="text-[10px] uppercase tracking-wide text-ink-faint"><th scope="col" className="py-1">Rol</th><th scope="col" className="py-1 text-right">OVR</th><th scope="col" className="py-1 text-right">Eje fuerte</th><th scope="col" className="py-1 text-right">Dif. OVR</th></tr></thead>
          <tbody>
            {a.roles.map((r) => (
              <tr key={r.role} className="border-t border-white/5">
                <th scope="row" className="py-1 font-medium text-white/85">{ROLE_SHORT[r.role]} <span className="text-ink-faint">({r.count})</span></th>
                <td className="py-1 text-right nx-readout tabular-nums text-white">{r.mean.ovr === null ? "—" : fmt1(r.mean.ovr)}</td>
                <td className="py-1 text-right text-white/80">{r.mainAxis ? METRIC_LABEL[r.mainAxis] : "—"}</td>
                <td className="py-1 text-right tabular-nums text-white/70">{r.ovrGap ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {a.count > 0 && (
        <details className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2" data-testid="lab-advanced">
          <summary className="nx-focus flex min-h-[44px] cursor-pointer items-center text-[12px] font-bold uppercase tracking-[0.1em] text-white/80">Detalles avanzados</summary>
          <table className="mt-1 w-full text-right text-[11.5px] tabular-nums">
            <caption className="sr-only">Media, mediana, rango, dispersión y percentiles (frente a cartas del catálogo y a equipos legales simulados) por métrica</caption>
            <thead><tr className="text-[10px] uppercase text-ink-faint"><th scope="col" className="py-1 text-left">Métrica</th><th scope="col">Media</th><th scope="col">Mediana</th><th scope="col">Rango</th><th scope="col">Desv.</th><th scope="col">Pct. cartas</th><th scope="col">Pct. equipos</th></tr></thead>
            <tbody>
              {METRICS.map((m) => {
                const s = a.metrics[m];
                return (
                  <tr key={m} className="border-t border-white/5 text-white/80">
                    <th scope="row" className="py-1 text-left font-medium">{METRIC_LABEL[m]}</th>
                    <td>{fmt1(s.mean)}</td><td>{fmt1(s.median)}</td><td>{s.min}–{s.max}</td><td>{fmt1(s.sd)}</td><td>{pLabel(a.catalogPercentile?.[m])}</td><td>{pLabel(a.deckPercentile?.[m])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {a.orientation && (
            <p className="mt-2 text-[11px] text-ink-muted">
              Distancia entre el eje más alto y el siguiente: {fmt1(a.orientation.gapSd)} σ · entre el más alto y el más bajo: {fmt1(a.orientation.spreadSd)} σ ·
              dispersión de OVR {pLabel(a.dispersionPercentile)}. Orientado ≥ 1 σ; equilibrado &lt; 0,5 σ.
            </p>
          )}
        </details>
      )}
    </section>
  );
}
