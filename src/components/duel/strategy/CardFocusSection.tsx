"use client";

/**
 * FASE 43 · LA CARTA SELECCIONADA — qué aporta y qué cambia si la sustituyes.
 *
 * Aportación: sus cifras, frente a la media del equipo y a su compañero de rol, y su percentil en el catálogo.
 * Alternativas: SOLO cartas tuyas que el validador canónico acepta en ese hueco, una por definición, con los deltas
 * EXACTOS de las medias del equipo (texto «+3 / −2 / =» y aria). «Vista previa» abre la comparación; nada se guarda.
 */
import { useState } from "react";
import { cn } from "@/lib/format";
import { AXES, METRICS, METRIC_ABBR, METRIC_LABEL, signedText, type AlternativeSort, type CardContribution, type SwapAlternative } from "@/domain/deckStrategy";
import { deltaChips, pLabel } from "@/lib/deckStrategy/presentation";

const PAGE = 12;

export function DeltaChips({ delta, decimals = 1, className }: { delta: Record<string, number>; decimals?: number; className?: string }) {
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {deltaChips(delta as never, decimals).map((c) => (
        <span key={c.metric} aria-label={c.aria} data-tone={c.tone} className={cn("inline-flex min-h-[24px] items-center rounded-md border px-1.5 text-[11px] font-bold tabular-nums", c.tone === "up" ? "border-ok/40 text-ok" : c.tone === "down" ? "border-bad/40 text-bad" : "border-white/15 text-ink-faint")}>
          <span aria-hidden>{c.abbr} {c.text}</span>
        </span>
      ))}
    </span>
  );
}

export function ContributionView({ c, partnerNick }: { c: CardContribution; partnerNick: string | null }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3" data-testid="card-contribution">
      <p className="nx-label">Aportación al equipo</p>
      {c.facts.length > 0 && <ul className="mt-1 flex flex-wrap gap-1.5">{c.facts.map((f) => <li key={f} className="rounded-full border border-drl-cyan/40 px-2 py-0.5 text-[11px] font-semibold text-drl-cyan">{f}</li>)}</ul>}
      <table className="mt-2 w-full text-right text-[12px] tabular-nums">
        <caption className="sr-only">Cifras de la carta frente al equipo, su compañero de rol y el catálogo</caption>
        <thead><tr className="text-[10px] uppercase text-ink-faint"><th scope="col" className="py-1 text-left">Métrica</th><th scope="col">Carta</th><th scope="col">vs media</th><th scope="col">vs {partnerNick ?? "compañero"}</th><th scope="col">Catálogo</th></tr></thead>
        <tbody>
          {METRICS.map((m) => (
            <tr key={m} className="border-t border-white/5 text-white/85">
              <th scope="row" className="py-1 text-left font-medium">{METRIC_LABEL[m]}</th>
              <td className="nx-readout text-white">{c.values[m]}</td>
              <td aria-label={`${METRIC_LABEL[m]} frente a la media ${signedText(c.vsDeck[m])}`}>{signedText(c.vsDeck[m])}</td>
              <td>{c.vsPartner ? signedText(c.vsPartner[m], 0) : "—"}</td>
              <td>{pLabel(c.catalogPercentile[m])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface CardFocusSectionProps {
  contribution: CardContribution | null;
  partnerNick: string | null;
  alternatives: SwapAlternative[];
  sort: AlternativeSort;
  onSort: (s: AlternativeSort) => void;
  onPreview: (alt: SwapAlternative) => void;
}

export function CardFocusSection({ contribution, partnerNick, alternatives, sort, onSort, onPreview }: CardFocusSectionProps) {
  const [shown, setShown] = useState(PAGE);
  return (
    <div className="mt-3 space-y-3" data-testid="card-focus">
      {contribution && <ContributionView c={contribution} partnerNick={partnerNick} />}
      <div className="rounded-xl border border-drl-cyan/25 bg-drl-cyan/[0.04] p-3" data-testid="swap-alternatives" data-count={alternatives.length}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="nx-label !text-drl-cyan">Si la sustituyes · {alternatives.length} {alternatives.length === 1 ? "alternativa tuya" : "alternativas tuyas"}</p>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Ordenar alternativas por">
          {(["ovr", ...AXES] as AlternativeSort[]).map((k) => (
            <button key={k} type="button" aria-pressed={sort === k} onClick={() => onSort(k)} className={cn("nx-focus min-h-[44px] rounded-control border px-3 text-[11px] font-bold uppercase tracking-wide", sort === k ? "border-drl-cyan bg-drl-cyan/15 text-white" : "border-white/15 text-white/70 hover:bg-white/5")}>
              Δ {METRIC_ABBR[k]}
            </button>
          ))}
        </div>
        {alternatives.length === 0 ? (
          <p className="mt-2 text-caption text-ink-muted" data-empty="no-alternatives">No tienes otra carta que pueda ocupar este hueco sin romper las reglas.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {alternatives.slice(0, shown).map((alt) => (
              <li key={alt.card.uid} data-alternative={alt.card.uid} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-2.5 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[13px] font-bold uppercase text-white">{alt.card.nick} <span className="nx-readout text-white/75">· {alt.card.ovr}</span>{alt.copies.length > 1 && <span className="ml-1 text-[10px] text-ink-faint">×{alt.copies.length} copias</span>}</span>
                  <span className="block text-[11px] text-ink-muted">{alt.impact.fit[0]}{alt.impact.identityChanged && alt.impact.orientationAfter ? ` · pasa a «${alt.impact.orientationAfter.label}»` : ""}</span>
                  <DeltaChips delta={alt.impact.delta} className="mt-1" />
                </span>
                <button type="button" onClick={() => onPreview(alt)} className="nx-focus min-h-[44px] shrink-0 rounded-control border border-drl-cyan/50 px-3 text-[11px] font-bold uppercase tracking-wide text-drl-cyan hover:bg-drl-cyan/10" aria-label={`Vista previa con ${alt.card.nick}`}>Vista previa</button>
              </li>
            ))}
          </ul>
        )}
        {alternatives.length > shown && (
          <button type="button" onClick={() => setShown((s) => s + PAGE)} className="nx-focus mt-2 min-h-[44px] w-full rounded-control border border-white/12 text-[12px] font-bold uppercase text-white/70 hover:bg-white/5">Ver más ({alternatives.length - shown})</button>
        )}
        <p className="mt-2 text-[11px] text-ink-faint">Deltas de las medias del equipo (antes → después), exactos y redondeados a un decimal. Ninguna carta es «mejor»: cambia el perfil.</p>
      </div>
    </div>
  );
}
