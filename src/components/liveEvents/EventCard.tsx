"use client";

/**
 * TARJETA DE EVENTO (Fase 30) — una por evento en la vista general. Solo datos reales del
 * snapshot: nombre, región si la hay, estado, progreso, próximo/en directo, participantes y
 * predicciones pendientes (con sesión). CTA: VER EVENTO. Sin artwork oficial: identidad NEXUS.
 */
import Link from "next/link";
import { Plate } from "@/components/ui/Surface";
import { Meter } from "@/components/ui/Meter";
import type { EventCardView } from "@/server/services/liveEvents";
import { EventStatusBadge, DemoTag, fmtRange, fmtWhen, Score } from "./bits";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("liveEvents");

const TINT: Record<EventCardView["lifecycle"], string> = { ACTIVE: "25,227,255", UPCOMING: "255,211,92", COMPLETED: "150,160,180" };

export function EventCard({ ev, main }: { ev: EventCardView; main?: boolean }) {
  useLocale();
  const tint = TINT[ev.lifecycle];
  const live = ev.liveMatch;
  const next = ev.nextMatch;
  return (
    <Plate tone={ev.lifecycle === "ACTIVE" ? "cyan" : "neutral"} className="relative overflow-hidden p-4 sm:p-5" data-event={ev.id} data-lifecycle={ev.lifecycle} data-main={main ? "yes" : "no"}>
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: `radial-gradient(420px 200px at 100% 0%, rgb(${tint} / 0.14), transparent 70%)` }} />
      <div className="flex flex-wrap items-center gap-2">
        <EventStatusBadge lifecycle={ev.lifecycle} label={td(ev.label)} live={ev.liveCount > 0} isDemo={ev.isDemo} />
        <DemoTag isDemo={ev.isDemo} />
        {ev.region && <span className="nx-label">{td(ev.region)}</span>}
        {ev.currentStage && <span className="nx-label">· {td(ev.currentStage)}</span>}
      </div>
      <h3 className="mt-2 font-display text-[clamp(18px,2.6vw,26px)] font-bold uppercase leading-tight text-white">
        <Link href={`/torneos/${ev.id}`} className="nx-focus underline-offset-4 hover:underline">{ev.name}</Link>
      </h3>
      <p className="mt-1 text-caption text-ink-muted">{fmtRange(ev.startDate, ev.endDate)}{ev.participants > 0 ? t(" · {participants} equipos", { participants: ev.participants }) : ""}</p>

      {ev.progress.total > 0 && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between text-[11px] text-white/50">
            <span>{ev.progress.completed} / {ev.progress.total} {t("partidos")}</span><span>{ev.progress.pct}%</span>
          </div>
          <Meter value={ev.progress.pct} tone={ev.lifecycle === "COMPLETED" ? "muted" : "key"} height={5} label={t("{completed} de {total} partidos completados", { completed: ev.progress.completed, total: ev.progress.total })} className="mt-1" />
        </div>
      )}

      {(live ?? next) && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.08] pt-3" data-strip={live ? "live" : "next"}>
          <span className="min-w-0">
            <span className="nx-label block">{live ? (ev.isDemo ? t("Partido de demo") : t("En directo")) : t("Próximo partido")}</span>
            <span className="block truncate text-[13px] text-white">{td((live ?? next)!.teamA) ?? t("Por decidir")} <span className="text-white/40">{t("vs")}</span> {td((live ?? next)!.teamB) ?? t("Por decidir")}</span>
            {!live && next && <span className="block text-[11px] text-white/45">{fmtWhen(next.startTime)}</span>}
          </span>
          {live && <Score m={live} />}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        {ev.pickem && ev.pickem.pending > 0
          ? <span className="text-[12px] text-drl-gold" data-pending={ev.pickem.pending}>{ev.pickem.pending} {ev.pickem.pending === 1 ? t("predicción pendiente") : t("predicciones pendientes")}</span>
          : ev.pickem && ev.pickem.open > 0 ? <span className="text-[12px] text-white/45">{t("Predicciones abiertas")}</span> : <span />}
        <Link href={`/torneos/${ev.id}`} className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center border border-drl-cyan/50 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-cyan transition hover:bg-drl-cyan/10">{t("Ver evento")}</Link>
      </div>
    </Plate>
  );
}
