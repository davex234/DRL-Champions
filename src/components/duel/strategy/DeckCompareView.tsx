"use client";

/**
 * FASE 43 · COMPARAR DOS EQUIPOS PROPIOS — diferencias de medias, orientación y roles. Sin ganador.
 */
import { useMemo, useState } from "react";
import { cn } from "@/lib/format";
import { compareDecks, signedText } from "@/domain/deckStrategy";
import type { DuelDeckDTO } from "@/lib/duel/types";
import { strategyContext } from "@/lib/deckStrategy/catalog";
import { dtoToStrategy, fmt1 } from "@/lib/deckStrategy/presentation";
import { ns, td as i18nTd } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const i18nT = ns("duel");

export function DeckCompareView({ decks, initialA, initialB }: { decks: DuelDeckDTO[]; initialA?: string; initialB?: string }) {
  useLocale();
  const [a, setA] = useState(initialA ?? decks[0]?.id ?? "");
  const [b, setB] = useState(initialB ?? decks[1]?.id ?? "");
  const da = decks.find((d) => d.id === a) ?? null;
  const db = decks.find((d) => d.id === b) ?? null;
  const cmp = useMemo(() => (da && db ? compareDecks(da.name, da.cards.map(dtoToStrategy), db.name, db.cards.map(dtoToStrategy), strategyContext()) : null), [da, db]);

  const select = (value: string, onChange: (v: string) => void, label: string) => (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
      {i18nTd(label)}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="nx-focus min-h-[44px] rounded-control border border-white/15 bg-[#0b0e17] px-2 text-[13px] normal-case text-white">
        {decks.map((d) => <option key={d.id} value={d.id}>{d.name}{d.valid ? "" : (" " + i18nT("(incompleto)"))}</option>)}
      </select>
    </label>
  );

  return (
    <div data-testid="deck-compare">
      <div className="flex flex-wrap gap-2">{select(a, setA, i18nT("Equipo A"))}{select(b, setB, i18nT("Equipo B"))}</div>
      {!cmp ? (
        <p className="mt-3 text-caption text-ink-muted">{i18nT("Necesitas dos equipos para comparar.")}</p>
      ) : a === b ? (
        <p className="mt-3 text-caption text-ink-muted">{i18nT("Elige dos equipos distintos.")}</p>
      ) : (
        <>
          <table className="mt-3 w-full text-right text-[13px] tabular-nums">
            <caption className="nx-label mb-1 text-left">{i18nT("Medias")}</caption>
            <thead><tr className="text-[10px] uppercase text-ink-faint"><th scope="col" className="text-left">{i18nT("Métrica")}</th><th scope="col" className="truncate">{i18nTd(cmp.nameA)}</th><th scope="col" className="truncate">{i18nTd(cmp.nameB)}</th><th scope="col">{i18nT("A − B")}</th></tr></thead>
            <tbody>
              {cmp.rows.map((r) => (
                <tr key={r.metric} className="border-t border-white/5">
                  <th scope="row" className="py-1.5 text-left font-medium text-white/85">{i18nTd(r.label)}</th>
                  <td className="text-white">{fmt1(r.a)}</td><td className="text-white">{fmt1(r.b)}</td>
                  <td className={cn(Math.round(r.diff * 10) > 0 ? "text-drl-cyan" : Math.round(r.diff * 10) < 0 ? "text-drl-gold" : "text-ink-faint")} aria-label={i18nTd(r.text)}>{signedText(r.diff)}</td>
                </tr>
              ))}
              <tr className="border-t border-white/5">
                <th scope="row" className="py-1.5 text-left font-medium text-white/85">{i18nT("Perfil")}</th>
                <td className="text-[12px] text-white">{i18nTd(cmp.orientation.a) ?? i18nT("Incompleto")}</td><td className="text-[12px] text-white">{i18nTd(cmp.orientation.b) ?? i18nT("Incompleto")}</td><td />
              </tr>
            </tbody>
          </table>
          <ul className="mt-2 space-y-0.5 text-[12.5px] text-white" data-testid="deck-compare-summary">
            {cmp.summary.length ? cmp.summary.map((t) => <li key={t}>· {i18nTd(t)}</li>) : <li>{i18nT("· Mismas medias en OVR y en los tres ejes.")}</li>}
          </ul>
          <table className="mt-3 w-full text-right text-[12px] tabular-nums">
            <caption className="nx-label mb-1 text-left">{i18nT("OVR medio por rol")}</caption>
            <tbody>
              {cmp.roles.map((r) => (
                <tr key={r.role} className="border-t border-white/5">
                  <th scope="row" className="py-1 text-left font-medium text-white/80">{i18nTd(r.role)}</th>
                  <td>{r.a === null ? "—" : fmt1(r.a)}</td><td>{r.b === null ? "—" : fmt1(r.b)}</td><td>{r.diff === null ? "—" : signedText(r.diff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-ink-faint">{i18nT("Comparación de cifras. No dice qué equipo gana: eso depende del rival y de cada decisión.")}</p>
        </>
      )}
    </div>
  );
}
