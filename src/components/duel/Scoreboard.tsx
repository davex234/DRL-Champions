"use client";

/**
 * MARCADOR DEL DUELO (Fase 8).
 *
 * Siempre visible durante la partida. Muestra lo que el servidor ya decidió: marcador, turno y
 * quién ataca. No cuenta puntos: los recibe.
 */
import { cn } from "@/lib/format";
import type { DuelMatchView, DuelTurnView } from "@/lib/duel/types";

/** Barra de los diez turnos: un punto por turno, con su resultado. */
export function TurnTrack({ view, className }: { view: DuelMatchView; className?: string }) {
  const byNumber = new Map(view.history.map((t) => [t.number, t]));
  return (
    <div className={cn("flex gap-1", className)} role="img" aria-label={`Turno ${view.turn} de ${view.totalTurns}`}>
      {Array.from({ length: view.totalTurns }, (_, i) => i + 1).map((n) => {
        const t = byNumber.get(n);
        const current = !t && n === view.turn && view.status === "IN_PROGRESS";
        return (
          <span
            key={n}
            className={cn(
              "h-1.5 flex-1 rounded-full transition",
              // Fase 50 · el punto del jugador es cian (su color en la arena); el turno en juego, blanco.
              t?.outcome === "A" && "bg-[#2fe0ff]",
              t?.outcome === "B" && "bg-drl",
              t?.outcome === "TIE" && "bg-white/45",
              !t && !current && "bg-white/10",
              current && "bg-white/85 shadow-[0_0_10px_rgba(255,255,255,0.6)]",
            )}
          />
        );
      })}
    </div>
  );
}

export function Scoreboard({ view, className }: { view: DuelMatchView; className?: string }) {
  const live = view.status === "IN_PROGRESS";
  return (
    <section
      className={cn(
        "rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] px-4 py-3",
        className,
      )}
      aria-label="Marcador"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">Tú</span>
          <b className="font-display text-3xl font-bold leading-none text-emerald-400 sm:text-4xl">{view.scoreYou}</b>
        </div>

        <div className="text-center">
          <span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-white/35">Turno</span>
          <b className="font-display text-base font-bold leading-tight sm:text-lg">
            {Math.min(view.turn, view.totalTurns)} / {view.totalTurns}
          </b>
          {live && (
            <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-[0.12em] text-drl">
              {view.youAreAttacker ? "Atacas tú" : "Ataca el rival"}
            </span>
          )}
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2.5">
          <b className="font-display text-3xl font-bold leading-none text-drl sm:text-4xl">{view.scoreRival}</b>
          <span className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">Bot</span>
        </div>
      </div>

      <TurnTrack view={view} className="mt-2.5" />

      <div className="mt-2 flex items-center justify-between text-[10px] text-white/40">
        <span>{view.yourHand.length} cartas</span>
        {view.ties > 0 && <span>{view.ties} {view.ties === 1 ? "empate" : "empates"}</span>}
        <span>{view.rivalRemaining} cartas</span>
      </div>
    </section>
  );
}

/** Resumen de un turno para el historial: quién ganó y con qué. */
export function turnLabel(t: DuelTurnView): { text: string; tone: "win" | "loss" | "tie" } {
  if (t.outcome === "A") return { text: "Ganas", tone: "win" };
  if (t.outcome === "B") return { text: "Pierdes", tone: "loss" };
  return { text: "Empate", tone: "tie" };
}
