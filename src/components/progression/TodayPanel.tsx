"use client";

/**
 * HOY EN NEXUS (Fase 27). Tres o cuatro acciones REALES, en el orden de la prioridad pura
 * (`todayActions`): partida a medias, recompensa pendiente, Pick'em abierto, objetivo casi
 * completo, sobre por abrir, equipo incompleto, jugar. Cada tarjeta es un enlace de verdad.
 */
import Link from "next/link";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { cn } from "@/lib/format";
import type { TodayAction, TodayKind } from "@/domain/progression/meta";

const KIND: Record<TodayKind, { tint: string; glyph: string }> = {
  resume:    { tint: "255,46,99",  glyph: "▸" },
  run:       { tint: "255,46,99",  glyph: "⟁" },
  claim:     { tint: "255,211,92", glyph: "✦" },
  predict:   { tint: "25,227,255", glyph: "◈" },
  objective: { tint: "25,227,255", glyph: "◐" },
  challenge: { tint: "25,227,255", glyph: "⬡" },
  open:      { tint: "255,138,61", glyph: "▣" },
  build:     { tint: "123,92,255", glyph: "⬢" },
  play:      { tint: "255,46,99",  glyph: "◆" },
  explore:   { tint: "63,192,122", glyph: "◎" },
};

export function TodayPanel({ actions, title = "Hoy en NEXUS", onAction }: { actions: TodayAction[]; title?: string; onAction?: (a: TodayAction) => void }) {
  if (actions.length === 0) {
    return (
      <section aria-label={title} data-today="empty">
        <SectionTitle>{title}</SectionTitle>
        <p className="nx-clip-sm border border-dashed border-white/12 px-4 py-5 text-center text-caption text-ink-muted">
          Nada pendiente ahora mismo. Cuando haya un objetivo, un sobre o una partida, aparecerá aquí.
        </p>
      </section>
    );
  }
  return (
    <section aria-label={title} data-today={actions.length}>
      <SectionTitle>{title}</SectionTitle>
      <ol className="grid gap-2.5 sm:grid-cols-2">
        {actions.map((a, i) => {
          const k = KIND[a.kind];
          return (
            <li key={a.id}>
              <Link
                href={a.href}
                onClick={() => onAction?.(a)}
                data-kind={a.kind}
                className={cn(
                  "nx-focus nx-clip-sm group relative flex min-h-[64px] items-center gap-3 overflow-hidden border px-4 py-3 transition duration-fast hover:-translate-y-0.5",
                )}
                style={{
                  borderColor: `rgb(${k.tint} / ${i === 0 || a.urgent ? 0.55 : 0.22})`,
                  background: `linear-gradient(150deg, rgb(${k.tint} / ${i === 0 ? 0.16 : 0.07}), rgba(255,255,255,0.015) 62%)`,
                }}
              >
                <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[15px]" style={{ background: `rgb(${k.tint} / 0.18)`, color: `rgb(${k.tint})` }}>
                  {k.glyph}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[14px] font-bold uppercase tracking-[0.05em] text-white">
                    {a.label}
                    {a.urgent && <span className="ml-2 font-display text-[9px] tracking-[0.14em]" style={{ color: `rgb(${k.tint})` }}>· caduca</span>}
                  </span>
                  <span className="block truncate text-[12.5px] text-white/55">{a.detail}</span>
                </span>
                {typeof a.count === "number" && a.count > 0 && (
                  <span className="nx-readout grid h-6 min-w-6 shrink-0 place-items-center rounded-chip px-1.5 text-[13px]" style={{ background: `rgb(${k.tint} / 0.18)`, color: `rgb(${k.tint})` }}>
                    {a.count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
