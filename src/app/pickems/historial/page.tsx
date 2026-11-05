"use client";

/**
 * MI HISTORIAL DE PICK'EMS (Fase 24.2) — los torneos en los que participé.
 *
 * Solo aparecen torneos con una submission mía: un torneo en el que no jugué no tiene
 * fila, no tiene ceros y no tiene posición inventada. Todo lo que se pinta sale de
 * `fetchMyPickemHistory` (seis lecturas por lote, da igual cuántos torneos haya):
 * puntos y aciertos de `pickem_scores`, posición por el criterio de la vista, recompensa
 * por el asiento real del libro mayor, estado por las fechas y el estado reales.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth";
import { fetchMyPickemHistory, type PickemHistoryRow } from "@/lib/game/client";
import { describeLedger } from "@/domain/pickems/ledger";
import { eventPhase, PHASE_LABEL, progressOf } from "@/domain/pickems/progress";
import { Loading, ErrorState, EmptyState, NeedsAccount, DemoBadge } from "@/components/ui/States";
import { Plate } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { NxButton } from "@/components/ui/NxButton";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { formatCredits } from "@/lib/format";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("pickems");

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(getIntlLocale(), { day: "numeric", month: "short", year: "numeric" }) : t("Sin fecha");

export default function PickemHistoryPage() {
  useLocale();
  const configured = isSupabaseConfigured();
  const { user, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<PickemHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setRows(await fetchMyPickemHistory()); }
    catch (e) { setError(e instanceof Error ? e.message : t("No se pudo cargar el historial")); setRows([]); }
  }, []);

  useEffect(() => { if (configured && user) load(); }, [configured, user, load]);

  const now = Date.now();

  return (
    <section className="animate-rise">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <span className="nx-label">{t("Pick'ems")}</span>
          <h1 className="mt-1 font-display text-[clamp(28px,5vw,44px)] font-bold uppercase leading-none text-white">
            {t("Mi historial")}
          </h1>
          <p className="mt-2 max-w-2xl text-body text-ink-muted">
            {t("Los torneos en los que has hecho predicciones, con tus puntos, aciertos, posición y recompensas.")}
          </p>
        </div>
        <NxButton variant="secondary" size="md" href="/pickems">{t("← Volver a Pick'ems")}</NxButton>
      </header>

      {!configured || (!authLoading && !user) ? (
        <NeedsAccount what={t("Tu historial de predicciones")} />
      ) : rows === null ? (
        <Loading label={t("Cargando tu historial")} />
      ) : error ? (
        <ErrorState message={td(error)} onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="🗳️"
          title={t("Todavía no has participado en ningún torneo")}
          hint={t("Haz tu primera predicción y este será el sitio donde quede tu palmarés.")}
          action={{ href: "/pickems", label: t("Ir a Pick'ems") }}
        />
      ) : (
        <>
          <SectionTitle as="h2">{t("Torneos")} <span className="text-ink-faint">({rows.length})</span></SectionTitle>
          <ol className="grid gap-3" aria-label={t("Torneos en los que participaste")}>
            {rows.map((r) => <HistoryCard key={r.pickemEventId} row={r} now={now} />)}
          </ol>
        </>
      )}
    </section>
  );
}

export function HistoryCard({ row, now }: { row: PickemHistoryRow; now: number }) {
  useLocale();
  const phase = eventPhase(
    { status: row.status, eventStatus: row.eventStatus, startDate: row.startDate, endDate: row.endDate },
    row.questions, now,
  );
  const p = progressOf(row.questions, row.answers);
  const reward = row.reward ? describeLedger(row.reward.reason, row.reward.ref) : null;
  const tone = phase === "activo" ? "cyan" : phase === "finalizado" && row.score ? "gold" : "neutral";

  return (
    <li>
      <Link
        href={`/pickems/historial/${row.pickemEventId}`}
        className="nx-focus block"
        aria-label={t("{name}: ver mis predicciones", { name: row.name })}
      >
        <Plate tone={tone} className="px-4 py-3.5 transition duration-fast hover:border-white/25 motion-reduce:transition-none sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-[240px]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={phase === "activo" ? "key" : phase === "proximo" ? "info" : "muted"} dot>
                  {td(PHASE_LABEL[phase])}
                </Badge>
                {row.isDemo && <DemoBadge />}
                <span className="nx-label">{fmtDate(row.startDate)}{row.endDate ? ` → ${fmtDate(row.endDate)}` : ""}</span>
              </div>
              <p className="mt-1.5 truncate font-display text-[clamp(17px,2.4vw,22px)] font-bold uppercase tracking-wide text-white">
                {row.name}
              </p>
              <p className="mt-1 text-caption text-ink-muted">
                {t("{n} de {total} respondidas", { n: p.answered, total: p.total })}
                {p.resolved > 0 && t(" · {n, plural, one {# acierto} other {# aciertos}} de {total} corregidas", { n: p.hits, total: p.hits + p.misses })}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-x-6 gap-y-1" aria-label={t("Tu resultado")}>
              <Readout size="sm" label={t("Puntos")} value={row.score ? formatCredits(row.score.points) : "—"} tone="var(--nx-gold)" />
              <Readout size="sm" label={t("Aciertos")} value={row.score ? String(row.score.correct) : "—"} tone="var(--nx-ok)" />
              <Readout size="sm" label={t("Posición")} value={row.position ? `#${row.position}` : "—"} />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            {reward?.tier ? (
              <Badge tone="gold" solid>{t("Recompensa conseguida ·")} {td(reward.tier.label)}</Badge>
            ) : row.score ? (
              <span className="nx-label">{t("Sin recompensa todavía")}</span>
            ) : (
              <span className="nx-label">{t("Sin clasificar todavía")}</span>
            )}
            <span className="ml-auto nx-label text-drl">{t("Ver predicciones →")}</span>
          </div>
        </Plate>
      </Link>
    </li>
  );
}
