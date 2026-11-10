"use client";

/**
 * ACTIVIDAD DEL EVENTO (Fase 30). Hechos derivados de datos reales —partidos terminados o en
 * directo, predicciones corregidas— ordenados por hora real. No hay redacción ni titulares.
 */
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Plate } from "@/components/ui/Surface";
import type { EventActivityItem } from "@/domain/liveEvents/eventState";
import { fmtWhen } from "./bits";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("liveEvents");

const GLYPH: Record<EventActivityItem["kind"], string> = { MATCH_FINISHED: "✓", MATCH_LIVE: "▸", MATCH_NEXT: "◷", PICK_RESOLVED: "◈", STAGE: "◐" };

export function EventActivity({ items }: { items: EventActivityItem[] }) {
  useLocale();
  return (
    <section aria-label={t("Actividad del evento")} data-testid="event-activity" data-count={items.length}>
      <SectionTitle>{t("Actividad")}</SectionTitle>
      {items.length === 0 ? (
        <Plate className="px-4 py-4 text-caption text-ink-muted">{t("Todavía no ha pasado nada: la actividad aparecerá con los primeros partidos.")}</Plate>
      ) : (
        <ol className="nx-clip-sm divide-y divide-white/[0.06] border border-white/[0.09] bg-white/[0.02]">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 px-3 py-2 text-[13px]" data-kind={it.kind}>
              <span aria-hidden className="w-5 text-center text-white/60">{td(GLYPH[it.kind])}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-white">{td(it.title)}</span><span className="block truncate text-[11px] text-white/45">{td(it.detail)}</span></span>
              <span className="shrink-0 text-[11px] text-white/40">{it.at ? fmtWhen(it.at) : ""}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
