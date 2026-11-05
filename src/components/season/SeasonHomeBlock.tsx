"use client";

/**
 * BLOQUE COMPACTO DE TEMPORADA (Fase 34) — vestíbulo y perfil propio. Contexto, no una acción que
 * compita con NextUp: nombre, estado, días restantes (del reloj del servidor) y enlace a /temporada.
 * Solo usa el calendario público (`?scope=calendar`): no lee nada personal.
 */
import Link from "next/link";
import { cn } from "@/lib/format";
import { useCountdown, useSeasonCalendar } from "@/lib/season/client";
import { PRESENTATION_LABEL } from "@/domain/season/calendar";
import { countdownSentence, elapsedFraction } from "@/domain/season/time";
import type { SeasonCalendarSnapshot } from "@/server/services/season";
import type { ServerClock } from "@/domain/season/time";

export function SeasonHomeBlock({ variant = "home", className }: { variant?: "home" | "profile"; className?: string }) {
  const { snap, clock, refresh } = useSeasonCalendar();
  if (!snap) return null;
  return <SeasonHomeBlockView snap={snap} clock={clock} onExpire={refresh} variant={variant} className={className} />;
}

export function SeasonHomeBlockView({ snap, clock, onExpire, variant = "home", className }: {
  snap: SeasonCalendarSnapshot; clock: ServerClock | null; onExpire?: () => void; variant?: "home" | "profile"; className?: string;
}) {
  const s = snap.current ?? snap.next ?? snap.previous;
  const target = s ? (s.status === "UPCOMING" ? s.startsAtMs : s.status === "ACTIVE" ? s.endsAtMs : null) : null;
  const c = useCountdown(target, clock, onExpire);
  if (!s) return null;
  const line = s.status === "ENDED" ? "Finalizada" : !c ? "" : s.status === "UPCOMING"
    ? `Comienza en ${c.days > 0 ? `${c.days} ${c.days === 1 ? "día" : "días"}` : `${c.hours} h`}`
    : c.underDay ? "Último día" : `${c.days} ${c.days === 1 ? "día restante" : "días restantes"}`;
  const cta = s.status === "ENDED" ? "Ver tu resumen" : s.presentation === "ENDING_SOON" || s.presentation === "FINAL_DAY" ? "Últimos días: revisa tu pase" : s.status === "UPCOMING" ? "Ver calendario" : "Ver temporada";
  const tone = s.presentation === "ENDING_SOON" || s.presentation === "FINAL_DAY" ? "255,211,92" : s.status === "ENDED" ? "180,170,150" : "25,227,255";

  return (
    <Link href="/temporada/pase" data-testid={`season-block-${variant}`} data-presentation={s.presentation}
      className={cn("nx-focus nx-clip-sm group relative flex min-h-[64px] flex-wrap items-center justify-between gap-x-4 gap-y-2 overflow-hidden border px-4 py-3 transition hover:brightness-110", className)}
      style={{ borderColor: `rgba(${tone},0.35)`, background: `linear-gradient(90deg, rgba(${tone},0.12), rgba(10,13,22,0.9) 60%)` }}>
      <span className="min-w-0">
        <span className="nx-label">{variant === "profile" ? "Tu temporada" : PRESENTATION_LABEL[s.presentation]}</span>
        <b className="block font-display text-[18px] font-bold uppercase tracking-[0.06em] text-white">{s.name}<span className="text-white/40"> · </span><span style={{ color: `rgb(${tone})` }}>{line}</span></b>
        {c && <span className="sr-only">{countdownSentence(c, s.status === "UPCOMING" ? "Comienza en" : "Termina en")}</span>}
      </span>
      <span className="flex items-center gap-3">
        <span aria-hidden className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-black/60 sm:block">
          <span className="block h-full rounded-full" style={{ width: `${elapsedFraction(s.startsAtMs, s.endsAtMs, snap.serverNow) * 100}%`, background: `rgb(${tone})` }} />
        </span>
        <span className="font-display text-[12px] font-bold uppercase tracking-[0.1em] text-white/80 group-hover:text-white">{cta} →</span>
      </span>
    </Link>
  );
}
