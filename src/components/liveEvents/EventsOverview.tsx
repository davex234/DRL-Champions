"use client";

/**
 * VISTA GENERAL DE EVENTOS (Fase 30) — EN CURSO · PRÓXIMAMENTE · FINALIZADOS, con eventos reales.
 * Recibe UN `EventsOverviewSnapshot` (del servidor o QA SYNTHETIC en el arnés). Soporta varios
 * eventos en curso a la vez; el principal es el primero de «En curso» según la regla del dominio.
 */
import { SectionTitle } from "@/components/ui/SectionTitle";
import { EmptyState } from "@/components/ui/States";
import type { EventsOverviewSnapshot } from "@/server/services/liveEvents";
import { EventCard } from "./EventCard";
import { SyncNotice } from "./bits";

export function EventsOverview({ snap }: { snap: EventsOverviewSnapshot }) {
  const total = snap.active.length + snap.upcoming.length + snap.completed.length;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-7" data-scene="events-overview" data-events={total}>
      <header>
        <span className="font-display text-label uppercase tracking-wide2 text-drl">Eventos</span>
        <h1 className="mt-1 font-display text-2xl font-bold uppercase tracking-wide text-white md:text-3xl">El circuito, en directo</h1>
        <p className="mt-1 max-w-lg text-sm text-ink-muted">Los torneos reales de VALORANT: partidos, predicciones, cartas de los equipos y objetivos mientras dura cada evento.</p>
      </header>
      <SyncNotice sync={snap.sync} />

      {total === 0 && <EmptyState icon="🏟️" title="No hay eventos publicados" hint="Cuando el circuito publique el siguiente torneo aparecerá aquí, con sus partidos y predicciones." />}

      {snap.active.length > 0 && (
        <section aria-label="En curso">
          <SectionTitle>En curso · {snap.active.length}</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">{snap.active.map((ev, i) => <EventCard key={ev.id} ev={ev} main={i === 0 && ev.id === snap.mainEventId} />)}</div>
        </section>
      )}
      {snap.upcoming.length > 0 && (
        <section aria-label="Próximamente">
          <SectionTitle>Próximamente · {snap.upcoming.length}</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">{snap.upcoming.map((ev) => <EventCard key={ev.id} ev={ev} main={ev.id === snap.mainEventId} />)}</div>
        </section>
      )}
      {snap.completed.length > 0 && (
        <section aria-label="Finalizados">
          <SectionTitle>Finalizados · {snap.completed.length}</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">{snap.completed.map((ev) => <EventCard key={ev.id} ev={ev} main={ev.id === snap.mainEventId} />)}</div>
        </section>
      )}
    </div>
  );
}
