"use client";

/**
 * F72.8 · EL CONTADOR DE LA DECISIÓN — uno solo, en el HUD de la partida (PvE: `MatchTopBar`; PvP: la barra de la
 * arena). «00:30 … 00:00». Gana énfasis en los últimos 10 s y urgencia en los últimos 5, sin destellos: un cambio de
 * color y, solo si el movimiento no está reducido, un latido suave. Solo pinta lo que dice el servidor.
 *
 * `TimeoutNotice` es el aviso breve «Tiempo agotado · jugada automática»: sin modal, sin botón, la partida sigue.
 */
import { cn } from "@/lib/format";
import { TURN_DECISION_MS, formatClock, timerUrgency } from "@/lib/duel/turnClock";
import type { DuelTimeoutView } from "@/lib/duel/types";

const TONE = {
  normal: "text-white/90",
  warn: "text-[#ffc24a]",
  critical: "text-[#ff2e63]",
  expired: "text-[#ff2e63]",
} as const;

export function TurnTimer({ ms, yours, className }: { ms: number | null; yours: boolean; className?: string }) {
  if (ms === null) return null;
  const urgency = timerUrgency(ms);
  const fraction = Math.max(0, Math.min(1, ms / TURN_DECISION_MS));
  const label = yours ? "Tu tiempo" : "Rival";
  return (
    <span
      role="timer"
      data-testid="turn-timer"
      data-urgency={urgency}
      data-yours={yours ? "true" : "false"}
      aria-label={`${label}: ${formatClock(ms)}`}
      className={cn(
        "relative flex shrink-0 flex-col items-center justify-center rounded-[3px] border bg-black/55 px-2 py-0.5 leading-none sm:px-2.5",
        urgency === "normal" ? "border-white/12" : urgency === "warn" ? "border-[#ffc24a]/55" : "border-[#ff2e63]/70",
        className,
      )}
    >
      <span className="hidden font-display text-[8px] font-bold uppercase tracking-[0.22em] text-white/50 sm:block">{label}</span>
      <b
        className={cn(
          "nx-readout text-[17px] tabular-nums sm:text-[19px]",
          TONE[urgency],
          urgency === "critical" && "motion-safe:animate-pulse",
        )}
        data-testid="turn-timer-value"
      >
        {formatClock(ms)}
      </b>
      <span aria-hidden className="mt-0.5 block h-[2px] w-full overflow-hidden rounded-full bg-white/10">
        <span
          className={cn("block h-full", urgency === "normal" ? "bg-white/60" : urgency === "warn" ? "bg-[#ffc24a]" : "bg-[#ff2e63]")}
          style={{ width: `${fraction * 100}%` }}
        />
      </span>
      {/* Solo se anuncia al cruzar los umbrales: un anuncio por segundo sería ruido. */}
      <span className="sr-only" aria-live="polite">
        {yours && urgency === "warn" ? "Quedan 10 segundos" : yours && urgency === "critical" ? "Quedan 5 segundos" : ""}
      </span>
    </span>
  );
}

export function TimeoutNotice({ notice, className }: { notice: DuelTimeoutView | null; className?: string }) {
  if (!notice) return null;
  return (
    <div
      role="status"
      data-testid="timeout-notice"
      data-you={notice.you ? "true" : "false"}
      className={cn(
        "pointer-events-none fixed left-1/2 top-[72px] z-50 -translate-x-1/2 rounded-[3px] border border-[#ff2e63]/60 bg-[#12030a]/92 px-3 py-1.5 text-center shadow-[0_6px_20px_rgba(0,0,0,0.6)]",
        className,
      )}
    >
      <b className="block font-display text-[12px] font-bold uppercase tracking-[0.2em] text-[#ff2e63]">Tiempo agotado</b>
      <span className="block text-[11px] text-white/80">
        {notice.you ? "Jugada automática" : "El rival agotó su tiempo · jugada automática"}
      </span>
    </div>
  );
}
