"use client";

/**
 * CALENDARIO DE TEMPORADA (Fase 34). Solo hechos: inicio y final (servidor), hoy, las semanas de la
 * temporada, las próximas rotaciones REALES de objetivos (`periods.ts`, UTC), los eventos del circuito
 * cuyas fechas tocan la ventana (sin vincularlos a la temporada) y la próxima temporada solo si existe.
 */
import { periodWindow } from "@/domain/progression/periods";
import { formatSeasonDate, formatShortDate } from "@/domain/season/time";
import type { SeasonHubSnapshot } from "@/server/services/season";
import { Panel } from "./SeasonPanels";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("season");

export function SeasonCalendar({ snap }: { snap: SeasonHubSnapshot }) {
  useLocale();
  const s = snap.season;
  const now = snap.serverNow;
  const weeks = Math.max(1, Math.round(s.durationMs / (7 * 86_400_000)));
  const todayPct = s.status === "ACTIVE" ? ((now - s.startsAtMs) / s.durationMs) * 100 : null;
  const daily = periodWindow("daily", now)!;
  const weekly = periodWindow("weekly", now)!;
  const next = snap.calendar.next && snap.calendar.next.id !== s.id ? snap.calendar.next : null;

  return (
    <Panel id="calendario" kicker={t("Calendario")} title={t("Línea de la temporada")}>
      <div className="overflow-x-auto pb-2">
        <div className="relative min-w-[520px] px-2 pt-8">
          <div className="relative h-3 rounded-full bg-black/60">
            {Array.from({ length: weeks }, (_, i) => (
              <span key={i} className="absolute inset-y-0 border-l border-white/15" style={{ left: `${(i / weeks) * 100}%` }}>
                <span className="absolute -top-5 -translate-x-1/2 text-[10px] text-white/40">S{i + 1}</span>
              </span>
            ))}
            {todayPct !== null && (
              <span className="absolute -inset-y-2 w-[2px] bg-drl-cyan shadow-[0_0_10px_rgba(25,227,255,0.9)]" style={{ left: `${todayPct}%` }} aria-hidden>
                <span className="absolute -bottom-5 -translate-x-1/2 whitespace-nowrap font-display text-[10px] font-bold uppercase text-drl-cyan">{t("Hoy")}</span>
              </span>
            )}
          </div>
          <div className="mt-6 flex justify-between text-[11px] text-ink-muted">
            <span>{t("Inicio ·")} {formatShortDate(s.startsAtMs)}</span>
            <span>{t("Final ·")} {formatShortDate(s.endsAtMs)}</span>
          </div>
        </div>
      </div>

      <ul className="mt-3 grid gap-2 text-caption sm:grid-cols-2" aria-label={t("Fechas de la temporada")}>
        <li className="rounded-[4px] border border-white/10 bg-black/30 px-3 py-2"><span className="nx-label block">{t("Inicio")}</span><time dateTime={s.startsAt} className="text-white">{formatSeasonDate(s.startsAtMs)}</time></li>
        <li className="rounded-[4px] border border-white/10 bg-black/30 px-3 py-2"><span className="nx-label block">{t("Final")}</span><time dateTime={s.endsAt} className="text-white">{formatSeasonDate(s.endsAtMs)}</time></li>
        {snap.isCurrent && s.status === "ACTIVE" && (
          <>
            <li className="rounded-[4px] border border-white/10 bg-black/30 px-3 py-2"><span className="nx-label block">{t("Próxima rotación diaria")}</span><time dateTime={new Date(daily.endsAt).toISOString()} className="text-white">{formatSeasonDate(daily.endsAt)}</time></li>
            <li className="rounded-[4px] border border-white/10 bg-black/30 px-3 py-2"><span className="nx-label block">{t("Próxima rotación semanal")}</span><time dateTime={new Date(weekly.endsAt).toISOString()} className="text-white">{formatSeasonDate(weekly.endsAt)}</time></li>
          </>
        )}
        <li className="rounded-[4px] border border-white/10 bg-black/30 px-3 py-2 sm:col-span-2" data-testid="next-season">
          <span className="nx-label block">{t("Próxima temporada")}</span>
          {next ? <span className="text-white">{fill(t("{nombre} · comienza el {fecha}", { nombre: next.name, ...slots("fecha") }), { fecha: <time dateTime={next.startsAt}>{formatSeasonDate(next.startsAtMs)}</time> })}</span> : <span className="text-ink-muted">{t("Aún no anunciada.")}</span>}
        </li>
      </ul>

      {snap.events.inWindow.length > 0 && (
        <div className="mt-3">
          <span className="nx-label">{t("Eventos del circuito en estas fechas")}</span>
          <ul className="mt-1.5 space-y-1">
            {snap.events.inWindow.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 text-caption"><span className="truncate text-white/85">{e.name}</span><span className="shrink-0 text-ink-muted">{e.startDate ? new Date(e.startDate).toLocaleDateString(getIntlLocale(), { day: "numeric", month: "short" }) : "—"} · {td(e.label)}</span></li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
