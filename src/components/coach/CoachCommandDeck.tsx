"use client";

/**
 * DECK DE ÓRDENES EN VIVO — el entrenador decide en CUALQUIER momento de la ronda.
 *
 * Muestra los comandos PERTINENTES ahora mismo (availableCommands) agrupados por
 * categoría, gastando "Voz". No mueve jugadores: emite una `CoachCommandId` que el
 * Coach Command Layer compila a las palancas que los motores leen.
 */
import type { RoundState } from "@/sim";
import { availableCommands, COACH_COMMANDS, type CoachCommandId, type CommandTone } from "@/coach";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("coach");

const TONE: Record<CommandTone, string> = {
  go: "border-emerald-400/50 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20",
  calm: "border-cyan-400/40 bg-cyan-400/5 text-cyan-100 hover:bg-cyan-400/15",
  danger: "border-rose-400/50 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20",
  info: "border-white/20 bg-white/5 text-white/80 hover:bg-white/15",
};

export function CoachCommandDeck({ snap, onCommand }: { snap: RoundState; onCommand: (id: CoachCommandId) => void }) {
  useLocale();
  const avail = availableCommands(snap);
  const disabled = snap.voz.left <= 0 || snap.phase === "ENDED";

  return (
    <div className="rounded-2xl border border-white/10 bg-base-800/70 p-3 backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-display text-[11px] uppercase tracking-[0.25em] text-drl">{t("Órdenes del entrenador")}</p>
        <span className="rounded-md border border-white/10 bg-base-900/60 px-2 py-0.5 font-display text-[11px] text-white/70">
          {t("🎙 Voz")} {snap.voz.left}/{snap.voz.total}
        </span>
      </div>
      {disabled ? (
        <p className="py-2 text-center text-[12px] text-white/40">{t("Sin Voz disponible esta ronda.")}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {avail.map((id) => {
            const m = COACH_COMMANDS[id];
            return (
              <button key={id} onClick={() => onCommand(id)} title={td(m.desc)}
                className={cn("rounded-lg border px-2.5 py-1.5 text-left font-display text-[11px] font-bold uppercase tracking-wide transition", TONE[m.tone])}>
                {td(m.label)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
