"use client";

/**
 * COMPARAR DOS CARTAS (Fase 37). OVR y las tres stats de combate del catálogo (`compareCombat`), con la diferencia en
 * texto (+3, −5, =) y en frase accesible. Sin veredicto: qué carta conviene depende del rol, del rival y del equipo.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { CardDef } from "@/domain/cards/types";
import { compareCombat } from "@/collection/compare";
import { normalizeText } from "@/collection/filter";
import { cardHref } from "@/domain/collection/room";
import { getPlayer } from "@/data/catalog";
import { canonicalCardTeam } from "@/data/teamIdentities";
import { getVariant } from "@/domain/cards/variants";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { cn } from "@/lib/format";

export function CardCompareView({ a, b, candidates, ownedIds, onPickB }: {
  a: CardDef;
  b: CardDef | null;
  candidates: CardDef[];
  ownedIds: Set<string>;
  onPickB: (cardId: string) => void;
}) {
  const [text, setText] = useState("");
  const cmp = b ? compareCombat(a, b) : null;
  const list = useMemo(() => {
    const t = normalizeText(text);
    return candidates
      .filter((c) => c.id !== a.id)
      .filter((c) => !t || normalizeText(getPlayer(c.playerId)?.nick).includes(t) || normalizeText(getPlayer(c.playerId)?.team).includes(t))
      .sort((x, y) => Number(ownedIds.has(y.id)) - Number(ownedIds.has(x.id)) || y.ovr - x.ovr || x.id.localeCompare(y.id))
      .slice(0, 24);
  }, [candidates, text, a.id, ownedIds]);

  return (
    <div className="space-y-5" data-testid="card-compare">
      <div className="grid grid-cols-2 items-start gap-3 sm:gap-6">
        <Side def={a} tag="Carta A" />
        {b ? <Side def={b} tag="Carta B" /> : <p className="nx-clip-sm grid aspect-[5/7] w-full max-w-[200px] place-items-center justify-self-center border border-dashed border-white/15 p-4 text-center text-caption text-ink-muted">Elige abajo la segunda carta</p>}
      </div>

      {cmp && (
        <div className="overflow-x-auto">
          {cmp.sameCard && <p className="mb-2 text-caption text-ink-muted">Es la misma carta: todas las diferencias son =.</p>}
          {!cmp.sameCard && cmp.samePlayer && <p className="mb-2 text-caption text-ink-muted">Dos variantes del mismo jugador: cambian el OVR y las stats por la edición.</p>}
          <table className="w-full min-w-[320px] border-collapse text-[14px]" data-testid="compare-table">
            <caption className="sr-only">Comparación de OVR y stats de combate</caption>
            <thead>
              <tr className="text-left font-display text-[11px] uppercase tracking-[0.12em] text-white/55">
                <th scope="col" className="py-2">Stat</th><th scope="col" className="py-2 text-right">A</th><th scope="col" className="py-2 text-right">B</th><th scope="col" className="py-2 text-right">A − B</th>
              </tr>
            </thead>
            <tbody>
              {cmp.rows.map((r) => (
                <tr key={r.key} className="border-t border-white/10">
                  <th scope="row" className="py-2 text-left font-semibold text-white">{r.label}</th>
                  <td className="nx-readout py-2 text-right text-white">{r.a}</td>
                  <td className="nx-readout py-2 text-right text-white">{r.b}</td>
                  <td className={cn("nx-readout py-2 text-right", r.delta > 0 ? "text-ok" : r.delta < 0 ? "text-bad" : "text-white/60")}>
                    <span aria-hidden>{r.deltaText}</span><span className="sr-only">{r.sentence}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-caption text-ink-muted">Sin veredicto: qué carta conviene depende del rol, del rival y de tu equipo.</p>
        </div>
      )}

      <div>
        <label className="flex min-h-[44px] items-center gap-2 border border-white/15 bg-black/30 px-3">
          <span aria-hidden className="text-ink-faint">⌕</span>
          <span className="sr-only">Buscar la segunda carta</span>
          <input value={text} onChange={(e) => setText(e.target.value.slice(0, 64))} placeholder="Buscar jugador o equipo…" className="nx-focus min-h-[44px] w-full bg-transparent text-white placeholder:text-ink-faint focus:outline-none" />
        </label>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Cartas para comparar (primero las tuyas)">
          {list.map((c) => {
            const p = getPlayer(c.playerId);
            return (
              <li key={c.id}>
                <button type="button" onClick={() => onPickB(c.id)} aria-pressed={b?.id === c.id}
                  className={cn("nx-focus nx-clip-sm flex min-h-[48px] w-full items-center justify-between gap-2 border px-3 text-left text-[13px]", b?.id === c.id ? "border-drl-cyan/60 bg-drl-cyan/10" : "border-white/10 bg-black/25 hover:border-white/30")}>
                  <span className="min-w-0"><span className="block truncate font-semibold text-white">{p?.nick ?? c.playerId}</span><span className="block truncate text-caption text-ink-muted">{canonicalCardTeam(c, p).label} · {getVariant(c.variantId).label}</span></span>
                  <span className="flex shrink-0 items-center gap-2"><span className="nx-readout text-white">{c.ovr}</span><span className="text-[11px] text-white/55">{ownedIds.has(c.id) ? "Tuya" : "No conseguida"}</span></span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Side({ def, tag }: { def: CardDef; tag: string }) {
  return (
    <figure className="flex flex-col items-center gap-2">
      <Link href={cardHref(def.id)} className="nx-focus block w-full max-w-[200px]" aria-label={`${tag}: ${def.id}, OVR ${def.ovr}. Abrir ficha`}>
        <PlayerCard card={def} size="md" interactive={false} />
      </Link>
      <figcaption className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-white/60">{tag}</figcaption>
    </figure>
  );
}
