"use client";

/**
 * CUENTA ATRÁS DE TEMPORADA (Fase 34). Hacia `startsAt` si aún no empezó, hacia `endsAt` si está en curso.
 * El instante lo da el servidor y el reloj se estima desde su `serverNow` (`useCountdown`). Al llegar a 0
 * pide otra foto (`onExpire`): no concede, no resetea y no cambia de temporada por su cuenta.
 *
 * Accesibilidad: `role="timer"` (sin anuncios en vivo) y una frase sin segundos como etiqueta.
 */
import { cn } from "@/lib/format";
import { useCountdown } from "@/lib/season/client";
import { countdownSentence, formatSeasonDate, type ServerClock } from "@/domain/season/time";
import type { SeasonView } from "@/server/services/season";

const pad = (n: number) => String(n).padStart(2, "0");

export function SeasonCountdown({
  season, clock, onExpire, size = "lg", className,
}: {
  season: SeasonView;
  clock: ServerClock | null;
  onExpire?: () => void;
  size?: "lg" | "sm";
  className?: string;
}) {
  const target = season.status === "UPCOMING" ? season.startsAtMs : season.status === "ACTIVE" ? season.endsAtMs : null;
  const c = useCountdown(target, clock, onExpire);
  const big = size === "lg";

  if (season.status === "ENDED" || !c) {
    return (
      <div className={cn("min-w-0", className)} data-countdown="ended">
        <span className="nx-label">Finalizó el</span>
        <p className={cn("font-display font-bold uppercase text-white/85", big ? "mt-1 text-[clamp(18px,2.4vw,26px)]" : "text-[14px]")}>
          <time dateTime={season.endsAt}>{formatSeasonDate(season.endsAtMs)}</time>
        </p>
      </div>
    );
  }

  const verb = season.status === "UPCOMING" ? "Comienza en" : "Termina en";
  const urgent = season.status === "ACTIVE" && c.underDay;
  const unit = (value: string, label: string) => (
    <span className="flex flex-col items-center">
      <b className={cn("nx-readout tabular-nums leading-none text-white", big ? "text-[clamp(44px,7vw,84px)]" : "text-[22px]")} style={{ textShadow: urgent ? "0 0 26px rgba(255,211,92,0.55)" : "0 0 26px rgba(25,227,255,0.35)" }}>{value}</b>
      <span className={cn("nx-label mt-1", !big && "!text-[9px]")}>{label}</span>
    </span>
  );

  return (
    <div className={cn("min-w-0", className)} data-countdown={c.underDay ? "clock" : "days"}>
      <span className={cn("nx-label", urgent && "!text-drl-gold")}>{season.status === "UPCOMING" ? "Comienza en" : urgent ? "Último día · tiempo restante" : "Tiempo restante"}</span>
      <div role="timer" aria-label={countdownSentence(c, verb)} className={cn("flex items-end", big ? "mt-2 gap-4 sm:gap-6" : "mt-1 gap-2")}>
        {c.underDay ? (
          <>
            {unit(pad(c.hours), "horas")}
            <span aria-hidden className={cn("nx-readout text-white/30", big ? "pb-6 text-[clamp(32px,5vw,60px)]" : "pb-3 text-[18px]")}>:</span>
            {unit(pad(c.minutes), "min")}
            <span aria-hidden className={cn("nx-readout text-white/30", big ? "pb-6 text-[clamp(32px,5vw,60px)]" : "pb-3 text-[18px]")}>:</span>
            {unit(pad(c.seconds), "seg")}
          </>
        ) : (
          <>
            {unit(String(c.days), c.days === 1 ? "día" : "días")}
            {unit(pad(c.hours), c.hours === 1 ? "hora" : "horas")}
          </>
        )}
      </div>
      {big && (
        <p className="mt-2 text-caption text-ink-muted">
          {season.status === "UPCOMING" ? "Empieza" : "Termina"} el <time dateTime={season.status === "UPCOMING" ? season.startsAt : season.endsAt}>{formatSeasonDate(season.status === "UPCOMING" ? season.startsAtMs : season.endsAtMs)}</time>
        </p>
      )}
    </div>
  );
}
