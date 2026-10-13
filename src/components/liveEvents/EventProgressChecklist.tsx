"use client";

/**
 * TU PROGRESO EN EL EVENTO (Fase 30): tres métricas SEPARADAS y reales —predicciones hechas,
 * objetivos completados, cartas del evento— sin una puntuación arbitraria que las mezcle.
 * Sin sesión, se explica qué se ganaría iniciándola.
 */
import { Plate } from "@/components/ui/Surface";
import { Meter } from "@/components/ui/Meter";
import { SectionTitle } from "@/components/ui/SectionTitle";
import type { EventHubSnapshot } from "@/server/services/liveEvents";

function Cell({ label, done, total, tone }: { label: string; done: number; total: number; tone: "key" | "gold" | "info" }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="min-w-0" data-progress={label.toLowerCase()} data-done={done} data-total={total}>
      <span className="nx-label">{label}</span>
      <span className="nx-readout mt-1 block text-[22px] text-white tabular-nums">{total === 0 ? "—" : `${done} / ${total}`}</span>
      <Meter value={pct} tone={tone} height={4} label={`${label}: ${done} de ${total}`} className="mt-1.5" />
    </div>
  );
}

export function EventProgressChecklist({ snap }: { snap: EventHubSnapshot }) {
  const p = snap.pickem;
  const o = snap.objectives;
  const c = snap.collection;
  const nothing = !p && o.items.length === 0 && !c;
  return (
    <section aria-label="Tu progreso en el evento" data-testid="event-progress">
      <SectionTitle>Tu progreso</SectionTitle>
      {!snap.signedIn ? (
        <Plate className="px-4 py-4 text-caption text-ink-muted">Inicia sesión para seguir tus predicciones, tus objetivos y tu colección del evento.</Plate>
      ) : nothing ? (
        <Plate className="px-4 py-4 text-caption text-ink-muted">Este evento todavía no tiene predicciones, objetivos ni cartas asociadas.</Plate>
      ) : (
        <Plate className="grid grid-cols-3 gap-4 px-4 py-4">
          <Cell label="Pick'ems" done={p?.answered ?? 0} total={p?.total ?? 0} tone="key" />
          <Cell label="Objetivos" done={o.items.filter((i) => i.complete).length} total={o.items.length} tone="gold" />
          <Cell label="Colección" done={c?.owned ?? 0} total={c?.total ?? 0} tone="info" />
        </Plate>
      )}
    </section>
  );
}
