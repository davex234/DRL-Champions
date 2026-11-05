"use client";

/**
 * F86 · EL CUADRO. Escritorio (≥ 1024): árbol horizontal, una columna por ronda, conectores entre cada pareja de
 * cruces y la ronda siguiente, con desplazamiento controlado si no cabe (64 = 6 columnas). Móvil y tableta estrecha:
 * pestañas por ronda + lista legible de cruces (nunca se encoge el árbol entero). «Ver mi partida» lleva a TU cruce en
 * cualquiera de las dos vistas. Todo el contenido sale del servidor (`CupRoundView`); aquí solo se coloca.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/format";
import type { CupRoundView } from "@/server/services/cups";
import { CupMatchCard, fmtDate } from "./CupParts";
import { ns } from "@/i18n/runtime";
import { roundText } from "@/lib/bracket/roundText";
import { useLocale } from "@/i18n/react";

const tr = ns("cups");

const ROW = 104; // alto reservado por cruce de la primera ronda (tarjeta + aire): el árbol entero se deriva de aquí

export function CupBracket({ rounds, className }: { rounds: CupRoundView[]; className?: string }) {
  useLocale();
  const mine = useMemo(() => {
    for (let i = rounds.length - 1; i >= 0; i--) {
      const m = rounds[i].matches.find((x) => x.you);
      if (m) return { round: rounds[i].round, slot: m.slot };
    }
    return null;
  }, [rounds]);
  const current = useMemo(() => {
    const live = rounds.find((r) => r.matches.some((m) => m.state === "READY" || m.state === "ACTIVE" || m.state === "ACTION_REQUIRED" || m.state === "NO_SHOW_PENDING"));
    return live?.round ?? rounds[rounds.length - 1]?.round ?? 1;
  }, [rounds]);
  const [tab, setTab] = useState<number>(mine?.round ?? current);
  useEffect(() => { setTab((t) => (rounds.some((r) => r.round === t) ? t : mine?.round ?? current)); }, [rounds, mine?.round, current]);
  const tree = useRef<HTMLDivElement>(null);

  const goMine = useCallback(() => {
    if (!mine) return;
    setTab(mine.round);
    // Las dos vistas tienen su propio id: se enfoca la que esté visible.
    requestAnimationFrame(() => {
      const ids = [`cup-m-${mine.round}-${mine.slot}`, `cup-l-${mine.round}-${mine.slot}`];
      const el = ids.map((id) => document.getElementById(id)).find((e) => e && e.offsetParent !== null);
      if (el) { el.scrollIntoView({ block: "center", inline: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); (el as HTMLElement).focus({ preventScroll: true }); }
    });
  }, [mine]);

  if (!rounds.length) return null;
  const first = rounds[0].matches.length;
  const shown = rounds.find((r) => r.round === tab) ?? rounds[0];

  return (
    <section aria-labelledby="cup-bracket-title" className={cn("min-w-0", className)} data-testid="cup-bracket">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="cup-bracket-title" className="font-display text-[20px] font-black uppercase tracking-wide text-white">{tr("Cuadro")}</h2>
        {mine && (
          <button type="button" onClick={goMine} data-testid="cup-go-mine"
            className="nx-focus nx-clip-sm min-h-[44px] px-4 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-[#19e3ff] shadow-[inset_0_0_0_1px_rgba(25,227,255,0.5)] hover:bg-[#19e3ff]/10">
            {tr("Ver mi partida")}
          </button>
        )}
      </div>

      {/* ── Escritorio: árbol ── */}
      <div ref={tree} className="hidden max-w-full overflow-x-auto pb-2 lg:block" data-testid="cup-tree" role="region" aria-label={tr("Cuadro completo, desplazable")} tabIndex={0}>
        <ol className="flex min-w-max gap-0" style={{ height: first * ROW }}>
          {rounds.map((r, ri) => (
            <li key={r.round} className="flex w-[244px] shrink-0 flex-col" aria-label={roundText(r.name)}>
              <div className="mb-1 h-11 px-4">
                <p className="font-display text-[13px] font-black uppercase tracking-[0.14em] text-white">{roundText(r.name)}</p>
                <p className="text-[11px] text-white/45">{fmtDate(r.availableAt)}</p>
              </div>
              <ol className="flex flex-1 flex-col">
                {r.matches.map((m) => {
                  const last = ri === rounds.length - 1;
                  return (
                    <li key={m.slot} className="relative flex flex-1 items-center px-4">
                      {ri > 0 && <span aria-hidden className="absolute left-0 top-1/2 w-4 border-t border-white/20" />}
                      {!last && <span aria-hidden className="absolute right-0 top-1/2 w-4 border-t border-white/20" />}
                      {!last && <span aria-hidden className={cn("absolute right-0 border-r border-white/20", m.slot % 2 === 0 ? "top-1/2 bottom-0" : "top-0 bottom-1/2")} />}
                      <CupMatchCard m={m} roundTitle={r.name} id={`cup-m-${m.round}-${m.slot}`} className="nx-focus outline-none" />
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      </div>

      {/* ── Móvil / tableta estrecha: pestañas por ronda + lista ── */}
      <div className="lg:hidden" data-testid="cup-rounds">
        <div role="tablist" aria-label={tr("Rondas")} className="-mx-1 mb-3 flex max-w-full gap-1.5 overflow-x-auto px-1 pb-1">
          {rounds.map((r) => (
            <button key={r.round} type="button" role="tab" aria-selected={r.round === shown.round} aria-controls="cup-round-panel" id={`cup-tab-${r.round}`}
              onClick={() => setTab(r.round)} data-testid="cup-round-tab"
              className={cn("nx-focus nx-clip-sm min-h-[44px] shrink-0 px-3 font-display text-[12px] font-bold uppercase tracking-[0.12em]",
                r.round === shown.round ? "bg-white/[0.12] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4)]" : "text-white/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]")}>
              {roundText(r.name)}{r.matches.some((m) => m.you) ? " ●" : ""}
            </button>
          ))}
        </div>
        <div id="cup-round-panel" role="tabpanel" aria-labelledby={`cup-tab-${shown.round}`}>
          <p className="mb-2 text-[12px] text-white/50">{tr("{ronda} · desde {desde} hasta {hasta}", { ronda: roundText(shown.name), desde: fmtDate(shown.availableAt), hasta: fmtDate(shown.deadlineAt) })}</p>
          <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {shown.matches.map((m) => (
              <li key={m.slot}><CupMatchCard m={m} roundTitle={shown.name} id={`cup-l-${m.round}-${m.slot}`} className="nx-focus outline-none" /></li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
