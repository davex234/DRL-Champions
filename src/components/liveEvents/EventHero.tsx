"use client";

/**
 * HERO DEL EVENTO (Fase 30). Solo datos reales: nombre, estado, fase actual, progreso de
 * partidos, participantes, fechas, sede y premio si existen, y el partido en directo o el
 * siguiente. Nada de esto está escrito a mano: viene del snapshot.
 */
import { Stage } from "@/components/ui/Surface";
import { Readout } from "@/components/ui/Readout";
import { Meter } from "@/components/ui/Meter";
import type { EventHubSnapshot } from "@/server/services/liveEvents";
import { EventStatusBadge, DemoTag, fmtRange, fmtWhen } from "./bits";

export function EventHero({ snap }: { snap: EventHubSnapshot }) {
  const { event, state } = snap;
  const live = snap.liveMatches[0] ?? null;
  const next = snap.nextMatches[0] ?? null;
  const featured = live ?? next;
  return (
    <Stage tone={state.lifecycle === "ACTIVE" ? "cyan" : state.lifecycle === "UPCOMING" ? "gold" : "neutral"} grid className="p-5 sm:p-7" data-testid="event-hero" data-lifecycle={state.lifecycle}>
      <div className="flex flex-wrap items-center gap-2">
        <EventStatusBadge lifecycle={state.lifecycle} label={state.label} live={state.liveCount > 0} isDemo={event.isDemo} />
        <DemoTag isDemo={event.isDemo} />
        {event.region && <span className="nx-label">{event.region}</span>}
        {state.currentStage && <span className="nx-label">· {state.currentStage}</span>}
      </div>
      <h1 className="mt-2 font-display text-[clamp(26px,5vw,48px)] font-bold uppercase leading-[0.95] text-white">{event.name}</h1>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Readout size="sm" label="Fechas" value={fmtRange(event.startDate, event.endDate)} />
        {snap.participants.length > 0 && <Readout size="sm" label="Equipos" value={snap.participants.length} />}
        {state.progress.total > 0 && <Readout size="sm" label="Partidos" value={`${state.progress.completed} / ${state.progress.total}`} tone="var(--nx-cyan)" />}
        {event.location && <Readout size="sm" label="Sede" value={event.location} />}
        {event.prizePool ? <Readout size="sm" label="Premio" value={event.prizePool.toLocaleString("es-ES")} unit="$" tone="var(--nx-gold)" /> : null}
      </div>
      {state.progress.total > 0 && <Meter value={state.progress.pct} tone={state.lifecycle === "COMPLETED" ? "muted" : "key"} height={5} label={`${state.progress.completed} de ${state.progress.total} partidos completados`} className="mt-3" />}

      {featured && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.08] pt-3" data-hero-match={live ? "live" : "next"}>
          <span className="nx-label">{live ? (event.isDemo ? "Partido de demo" : "En directo") : "Próximo"}</span>
          <span className="font-display text-[15px] font-bold uppercase text-white">{featured.teamA ?? "Por decidir"} <span className="text-white/40">vs</span> {featured.teamB ?? "Por decidir"}</span>
          {live ? <span className="nx-readout text-[18px] text-drl tabular-nums">{live.scoreA ?? 0}–{live.scoreB ?? 0}</span> : <span className="text-[12px] text-white/50">{fmtWhen(featured.startTime)}</span>}
        </div>
      )}
    </Stage>
  );
}
