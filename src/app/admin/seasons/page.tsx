"use client";

/**
 * F58 · /admin/seasons — calendario del código (resuelto en el servidor con la misma función que el juego) y pase.
 * F83 · y la RUTA DE TEMPORADA en BD (`SeasonTrackAdmin`): borrador, curva, recompensas, retos, economía y publicación.
 * NO hay botón «Terminar temporada»: no existe ese proceso en el dominio (la temporada acaba por calendario) y un botón
 * que no hace nada —o que haría algo que nadie ha diseñado— es peor que ninguno.
 */
import { useAdminQuery, fmt, dateTime } from "@/components/admin/cc/api";
import { PageHeader, Panel, Pill, Loading, ErrorBox, DataTable, LevelBadge, KV } from "@/components/admin/cc/ui";
import { SeasonTrackAdmin } from "@/components/admin/seasons/SeasonTrackAdmin";

interface S { id: string; name: string; startsAt: string; endsAt: string; status: string; presentation: string; progress: number; daysLeft: number }
interface V { phase: string; seasons: S[]; current: S | null; issues: { code: string; seasonId: string }[]; pass: { id: string; name: string }; closeProcess: string; passHolders: number | null }

export default function Seasons() {
  const q = useAdminQuery<V>("/api/admin/catalog?view=seasons");
  const d = q.data;
  return (
    <>
      <PageHeader eyebrow="Juego" title="Temporadas" description="Fuente única: el calendario de temporadas del código (loadSeasonCalendar). El servidor del juego resuelve la temporada con la misma función que se usa aquí." />
      {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
      {!d && !q.error && <Loading />}
      <div className="mb-6"><SeasonTrackAdmin /></div>
      {d && (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
            <Panel title="Temporada actual" tone="cyan">
              {d.current ? (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="font-display text-3xl font-bold uppercase text-ink-primary">{d.current.name}</p><Pill tone="ok">{d.current.presentation}</Pill></div>
                  <p className="mt-1 text-[13px] text-ink-muted">{dateTime(d.current.startsAt)} → {dateTime(d.current.endsAt)} · quedan {d.current.daysLeft} días</p>
                  <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-label="Progreso" aria-valuenow={Math.round(d.current.progress * 100)} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-gradient-to-r from-drl via-drl-gold to-drl-cyan" style={{ width: `${d.current.progress * 100}%` }} /></div>
                  <p className="mt-2 text-right text-[12px] tabular-nums text-ink-faint">{Math.round(d.current.progress * 100)} %</p>
                </>
              ) : <p className="text-ink-muted">Fase: {d.phase}. No hay temporada activa.</p>}
            </Panel>
            <Panel title="Pase y cierre">
              <KV items={[["Pase", `${d.pass.name} (${d.pass.id})`], ["Jugadores con pase", fmt(d.passHolders)], ["Fase del calendario", d.phase], ["Conflictos del calendario", d.issues.length ? d.issues.map((i) => `${i.code} ${i.seasonId}`).join(", ") : "Ninguno"]]} />
              <div className="mt-4 flex gap-2 rounded-card border border-white/10 bg-white/[0.02] p-3 text-[13px] text-ink-muted"><LevelBadge level="INFO" label="Cierre" />{d.closeProcess}</div>
            </Panel>
          </div>
          <Panel title="Calendario">
            <DataTable caption="Temporadas" rows={d.seasons} rowKey={(r) => r.id}
              cols={[
                { key: "n", label: "Temporada", render: (r) => <b className="text-ink-primary">{r.name}</b> },
                { key: "i", label: "Id", render: (r) => <code className="text-[12px]">{r.id}</code> },
                { key: "s", label: "Inicio", render: (r) => dateTime(r.startsAt) },
                { key: "e", label: "Fin", render: (r) => dateTime(r.endsAt) },
                { key: "st", label: "Estado", render: (r) => <Pill tone={r.status === "ACTIVE" ? "ok" : r.status === "UPCOMING" ? "cyan" : "default"}>{r.status}</Pill> },
                { key: "p", label: "Progreso", align: "right", render: (r) => `${Math.round(r.progress * 100)} %` },
              ]} />
          </Panel>
        </div>
      )}
    </>
  );
}
