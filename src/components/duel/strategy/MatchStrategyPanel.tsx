"use client";

/**
 * FASE 43 · QUÉ PASÓ EN LA PARTIDA — hechos, no causas.
 *
 * Deriva de los turnos que el servidor GUARDÓ (la misma vista del resultado y de la repetición); el motor no se vuelve
 * a ejecutar. Por eje: comparaciones, ganadas, perdidas, empatadas y balance de puntos. Por carta: su turno. Cómo se
 * resolvió el marcador según duel-combat-2. «Ajustar equipo» abre el constructor con ese equipo; el eje es contexto.
 */
import { cn } from "@/lib/format";
import { METRIC_LABEL, signedText } from "@/domain/deckStrategy";
import type { DuelResultView, DuelTurnView } from "@/lib/duel/types";
import { AXIS_COLOR, adjustDeckHref, matchSummaryFromView } from "@/lib/deckStrategy/presentation";
import { NxButton } from "@/components/ui/NxButton";

export interface MatchStrategyPanelProps {
  history: DuelTurnView[];
  result: DuelResultView | null;
  /** Equipo propio usado, si se conoce (PvE). Sin id, no hay CTA de ajuste. */
  deckId?: string | null;
  className?: string;
  /** «Repetición» o «Resultado»: solo cambia el título. */
  context?: "result" | "replay";
}

export function MatchStrategyPanel({ history, result, deckId = null, className, context = "result" }: MatchStrategyPanelProps) {
  if (history.length === 0) return null;
  const s = matchSummaryFromView(history, result);
  const href = adjustDeckHref(deckId, s.contextAxis);
  return (
    <section aria-labelledby={`strategy-${context}-title`} className={cn("nx-clip border border-white/10 bg-[linear-gradient(170deg,rgba(63,210,255,0.06),rgba(0,0,0,0.25))] p-4 sm:p-5", className)} data-testid="match-strategy" data-consistent={s.consistent}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`strategy-${context}-title`} className="font-display text-h3 font-bold uppercase tracking-wide text-white">Lectura de la partida</h2>
        <span className="text-[11px] text-ink-faint">{s.turns} turnos guardados · {s.wins} ganados · {s.losses} perdidos · {s.ties} empatados</span>
      </div>

      {s.insights.length > 0 && (
        <ul className="mt-3 space-y-1" data-testid="match-insights">
          {s.insights.map((t) => <li key={t} className="text-[14px] font-semibold text-white"><span aria-hidden className="mr-2 text-drl-cyan">●</span>{t}</li>)}
        </ul>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-3" data-testid="axis-performance">
        {s.axes.map((a) => (
          <div key={a.axis} data-axis={a.axis} className="nx-clip-sm border border-white/10 bg-black/25 px-3 py-2" aria-label={`${METRIC_LABEL[a.axis]}: ${a.timesCompared} comparaciones, ${a.wins} ganadas, ${a.losses} perdidas, ${a.ties} empatadas`}>
            <p className="font-display text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: AXIS_COLOR[a.axis] }}>{METRIC_LABEL[a.axis]}</p>
            {a.timesCompared === 0 ? (
              <p className="mt-1 text-caption text-ink-muted">No se usó.</p>
            ) : (
              <>
                <p aria-hidden className="nx-readout mt-1 text-[22px] tabular-nums text-white">{a.wins}<span className="text-white/40">/{a.timesCompared}</span></p>
                <p aria-hidden className="text-[11.5px] text-ink-secondary">ganadas · {a.losses} perdidas · {a.ties} empates · puntos {signedText(a.pointDelta, 0)}</p>
                <p aria-hidden className="text-[10.5px] text-ink-faint">{a.asAttacker} atacando · {a.asDefender} defendiendo</p>
              </>
            )}
          </div>
        ))}
      </div>

      {s.resolution && (
        <div className="mt-3 border-l-2 border-l-drl-gold pl-3" data-testid="match-resolution" data-decided-by={s.resolution.decidedBy}>
          {s.resolution.lines.map((l) => <p key={l} className="text-[12.5px] leading-relaxed text-ink-secondary">{l}</p>)}
          {!s.consistent && <p className="text-[11.5px] text-drl-gold">Los turnos guardados no cuadran con el marcador: se muestran sin sacar conclusiones.</p>}
        </div>
      )}

      <details className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2" data-testid="card-performance">
        <summary className="nx-focus flex min-h-[44px] cursor-pointer items-center text-[12px] font-bold uppercase tracking-[0.1em] text-white/80">Tus cartas, turno a turno</summary>
        <table className="mt-1 w-full text-left text-[12px]">
          <caption className="sr-only">Resultado del turno de cada carta</caption>
          <thead><tr className="text-[10px] uppercase text-ink-faint"><th scope="col" className="py-1">Carta</th><th scope="col">Eje</th><th scope="col" className="text-right">Valor</th><th scope="col" className="text-right">Turno</th></tr></thead>
          <tbody>
            {s.cards.map((c) => (
              <tr key={c.uid} className="border-t border-white/5 text-white/85">
                <th scope="row" className="py-1 font-medium">{c.nick}</th>
                <td>{c.stats.map((x) => METRIC_LABEL[x]).join(", ")}</td>
                <td className="text-right tabular-nums">{c.values.join(", ")}</td>
                <td className="text-right">{c.wins ? "Ganado" : c.losses ? "Perdido" : "Empate"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {href && <NxButton variant="secondary" size="md" href={href} data-testid="adjust-deck">Ajustar equipo</NxButton>}
        <p className="text-[11px] text-ink-faint">Hechos de los turnos jugados. No indican por qué se ganó o se perdió ni qué cambiar.</p>
      </div>
    </section>
  );
}
