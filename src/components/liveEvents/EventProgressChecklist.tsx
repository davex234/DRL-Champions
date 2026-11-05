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
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("liveEvents");

function Cell({ label, done, total, tone }: { label: string; done: number; total: number; tone: "key" | "gold" | "info" }) {
  useLocale();
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="min-w-0" data-progress={label.toLowerCase()} data-done={done} data-total={total}>
      <span className="nx-label">{td(label)}</span>
      <span className="nx-readout mt-1 block text-[22px] text-white tabular-nums">{total === 0 ? "—" : `${done} / ${total}`}</span>
      <Meter value={pct} tone={tone} height={4} label={t("{label}: {done} de {total}", { label: td(label), done, total })} className="mt-1.5" />
    </div>
  );
}

export function EventProgressChecklist({ snap }: { snap: EventHubSnapshot }) {
  useLocale();
  const p = snap.pickem;
  const o = snap.objectives;
  const c = snap.collection;
  const nothing = !p && o.items.length === 0 && !c;
  return (
    <section aria-label={t("Tu progreso en el evento")} data-testid="event-progress">
      <SectionTitle>{t("Tu progreso")}</SectionTitle>
      {!snap.signedIn ? (
        <Plate className="px-4 py-4 text-caption text-ink-muted">{t("Inicia sesión para seguir tus predicciones, tus objetivos y tu colección del evento.")}</Plate>
      ) : nothing ? (
        <Plate className="px-4 py-4 text-caption text-ink-muted">{t("Este evento todavía no tiene predicciones, objetivos ni cartas asociadas.")}</Plate>
      ) : (
        <Plate className="grid grid-cols-3 gap-4 px-4 py-4">
          <Cell label={t("Pick'ems")} done={p?.answered ?? 0} total={p?.total ?? 0} tone="key" />
          <Cell label={t("Objetivos")} done={o.items.filter((i) => i.complete).length} total={o.items.length} tone="gold" />
          <Cell label={t("Colección")} done={c?.owned ?? 0} total={c?.total ?? 0} tone="info" />
        </Plate>
      )}
    </section>
  );
}
