"use client";

/**
 * ARCHIVO DE TEMPORADAS (Fase 34). La actual y las anteriores que EXISTEN en el calendario canónico. Con
 * una sola temporada no se inventa ninguna anterior (ni pretemporada, ni beta).
 */
import Link from "next/link";
import { cn } from "@/lib/format";
import { PRESENTATION_LABEL } from "@/domain/season/calendar";
import { formatShortDate } from "@/domain/season/time";
import type { SeasonCalendarSnapshot, SeasonView } from "@/server/services/season";

function Row({ s, current }: { s: SeasonView; current: boolean }) {
  return (
    <li>
      <Link href={current ? "/temporada/pase" : `/temporadas/${s.slug}`} className={cn("nx-focus nx-clip-sm flex min-h-[64px] items-center justify-between gap-3 border px-4 py-3 transition hover:border-white/30", current ? "border-drl-cyan/45 bg-drl-cyan/[0.06]" : "border-white/10 bg-black/30")} data-season={s.id}>
        <span className="min-w-0">
          <b className="block font-display text-[18px] font-bold uppercase tracking-[0.06em] text-white">{s.displayName}</b>
          <span className="text-caption text-ink-muted">{formatShortDate(s.startsAtMs)} – {formatShortDate(s.endsAtMs)} · {Math.round(s.durationMs / 86_400_000)} días</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {current && <span className="rounded-[3px] bg-drl-cyan px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-black">Actual</span>}
          <span className="text-[11px] uppercase tracking-[0.1em] text-white/60">{PRESENTATION_LABEL[s.presentation]}</span>
        </span>
      </Link>
    </li>
  );
}

export function SeasonArchive({ calendar }: { calendar: SeasonCalendarSnapshot }) {
  const current = calendar.current;
  const past = calendar.seasons.filter((s) => s.status === "ENDED").reverse();
  const upcoming = calendar.seasons.filter((s) => s.status === "UPCOMING");
  return (
    <div className="space-y-6" data-testid="season-archive">
      <section aria-labelledby="archive-current">
        <h2 id="archive-current" className="nx-label mb-2">Temporada actual</h2>
        {current ? <ul><Row s={current} current /></ul> : <p className="text-body text-ink-muted">Ahora mismo no hay ninguna temporada en curso.</p>}
      </section>
      {upcoming.length > 0 && (
        <section aria-labelledby="archive-next">
          <h2 id="archive-next" className="nx-label mb-2">Próximas</h2>
          <ul className="space-y-2">{upcoming.map((s) => <Row key={s.id} s={s} current={false} />)}</ul>
        </section>
      )}
      <section aria-labelledby="archive-past">
        <h2 id="archive-past" className="nx-label mb-2">Temporadas anteriores</h2>
        {past.length > 0 ? <ul className="space-y-2">{past.map((s) => <Row key={s.id} s={s} current={false} />)}</ul> : <p className="text-body text-ink-muted" data-testid="archive-empty">Todavía no hay temporadas anteriores: la Temporada 1 es la primera de NEXUS.</p>}
      </section>
    </div>
  );
}
