"use client";

/**
 * FASE 55 · TEMPORADA ACTUAL en el competitivo. La temporada es la del calendario canónico (`SEASON_CALENDAR`,
 * la misma que `/temporada`) y el récord es el tramo del libro de rating dentro de su ventana: partidas,
 * V/D/E, neto y mejor rating ALCANZADO en la temporada. El rating no se reinicia al cerrar la temporada
 * (no hay cierre implementado): se dice, no se simula.
 */
import Link from "next/link";
import { cn } from "@/lib/format";
import type { CompetitiveSeason } from "@/server/services/competitive";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("competitive");

const DAY = 86_400_000;

function remainingLabel(ms: number): string {
  if (ms <= 0) return t("Termina hoy");
  const d = Math.floor(ms / DAY);
  if (d >= 2) return t("Quedan {d} días", { d });
  if (d === 1) return t("Queda 1 día");
  const h = Math.max(1, Math.floor(ms / 3_600_000));
  return t("Quedan {h} h", { h });
}

export function SeasonStrip({ season, className }: { season: CompetitiveSeason | null; className?: string }) {
  useLocale();
  if (!season) {
    return (
      <section aria-label={t("Temporada")} className={cn("nx-clip-sm border border-white/10 bg-white/[0.03] px-4 py-3", className)} data-testid="ranked-season" data-season="none">
        <p className="text-caption text-ink-muted">{t("No hay una temporada activa ahora mismo. Tu rating ranked sigue contando igual.")}</p>
      </section>
    );
  }
  const r = season.record;
  return (
    <section
      aria-label={t("Temporada actual")}
      className={cn("nx-clip relative flex flex-col gap-3 overflow-hidden border border-drl-gold/25 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5", className)}
      style={{ background: "linear-gradient(100deg, rgba(255,211,92,0.10), rgba(0,0,0,0.25) 60%)" }}
      data-testid="ranked-season" data-season={season.id} data-presentation={season.presentation}
    >
      <div className="min-w-0">
        <p className="nx-label !text-drl-gold">{t("Temporada actual")}</p>
        <p className="mt-0.5 font-display text-[18px] font-bold uppercase leading-tight text-white">{td(season.displayName)}</p>
        <p className="text-[12px] text-white/55">{t("{resto} · tu rating continúa entre temporadas", { resto: remainingLabel(season.remainingMs) })}</p>
      </div>
      <dl className="grid grid-cols-4 gap-2 sm:flex sm:gap-5" data-testid="season-record">
        <Cell label={t("Partidas")} value={String(r.matches)} />
        <Cell label={t("V · D · E")} value={`${r.wins}·${r.losses}·${r.draws}`} />
        <Cell label={t("Neto")} value={r.matches > 0 ? `${r.net > 0 ? "+" : ""}${r.net}` : "—"} tone={r.net > 0 ? "text-ok" : r.net < 0 ? "text-drl-glow" : undefined} />
        <Cell label={t("Mejor")} value={r.best !== null ? String(r.best) : "—"} tone="text-drl-gold" />
      </dl>
      <Link href="/temporada/pase" className="nx-action shrink-0 self-start sm:self-center" data-testid="ranked-season-link">{t("Ver temporada →")}</Link>
      {r.truncated && <p className="text-[11px] text-white/45 sm:hidden">{t("Récord de las últimas partidas de la temporada.")}</p>}
    </section>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  useLocale();
  return (
    <div className="min-w-0 text-center sm:text-left">
      <dt className="nx-label !text-[9.5px] !text-white/45">{td(label)}</dt>
      <dd className={cn("nx-readout text-[17px] leading-tight text-white", tone)}>{td(value)}</dd>
    </div>
  );
}
