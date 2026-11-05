"use client";

/**
 * ORGANIZACIÓN DEL CLUB — panel PROFESIONAL de dirigir una org de esports (Career Fase 5).
 *
 * SOLO pinta lo que prepara `organizationDashboard` (motor puro `@/career`): valor total del
 * club, prestigio DESGLOSADO, fanbase con ánimo, organigrama (11 posiciones), finanzas por
 * líneas, sponsors con personalidad y academia de cuerpo técnico. Dispara acciones del store.
 */
import { useMemo } from "react";
import { useManagerStore } from "@/store/useManagerStore";
import { useWorldStore } from "@/store/useWorldStore";
import { organizationDashboard, clubViewFor, SPONSOR_PERSONALITY_LABEL, STAFF_LABEL } from "@/career";
import { playerValue } from "@/world";
import { formatCredits, cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("career");

const MOOD_COLOR: Record<string, string> = { eufórica: "text-emerald-400", contenta: "text-drl-cyan", neutral: "text-white/60", inquieta: "text-amber-400", enfadada: "text-rose-400" };
const PRESTIGE_SOURCES: [key: string, label: string][] = [
  ["results", "Resultados"], ["content", "Contenido"], ["fans", "Afición"], ["history", "Historia"], ["legends", "Leyendas"],
  ["academy", "Academia"], ["staff", "Staff"], ["sponsors", "Sponsors"], ["facilities", "Instalaciones"], ["transfers", "Fichajes"],
];

export function ClubOrganization() {
  useLocale();
  const career = useManagerStore((s) => s.career)!;
  const world = useWorldStore((s) => s.world);
  const promoteStaff = useManagerStore((s) => s.promoteStaffProspect);

  const mgmt = career.management;
  const club = useMemo(() => (career.clubId && world ? clubViewFor(world, career.clubId) : null), [career.clubId, world]);
  const squadValue = useMemo(() => {
    if (!world || !career.clubId) return 0;
    const t = world.teams[career.clubId];
    return t ? t.roster.reduce((a, id) => a + (world.players[id] ? playerValue(world.players[id]) : 0), 0) : 0;
  }, [world, career.clubId]);

  if (!mgmt || !club) return null;
  const dash = organizationDashboard(mgmt, club, squadValue);
  const bd = dash.prestigeBreakdown;

  return (
    <section className="space-y-5 rounded-2xl border border-drl-cyan/20 bg-gradient-to-br from-base-800/60 to-base-900/70 p-5">
      <header className="flex flex-wrap items-center gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-drl-cyan/30 bg-drl-cyan/10 text-2xl">🏛️</div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold text-white">{tr("Organización ·")} {club.name}</h2>
          <p className="text-xs text-white/50">{td(dash.prestigeTier)} {tr("· afición")} <span className={MOOD_COLOR[dash.fanbaseMood]}>{td(dash.fanbaseMood)}</span></p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          <Kpi label={tr("Valor del club")} value={formatCredits(dash.clubValue.total)} big />
          <Kpi label={tr("Prestigio")} value={`${dash.prestige}`} />
          <Kpi label={tr("Fanbase")} value={`${dash.fanbase}`} />
          <Kpi label={tr("Ánimo")} value={`${dash.fanbaseMoodScore}`} />
        </div>
      </header>

      {/* Valor del club desglosado */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Mini label={tr("Plantilla")} value={formatCredits(dash.clubValue.squad)} />
        <Mini label={tr("Instalaciones")} value={formatCredits(dash.clubValue.facilities)} />
        <Mini label={tr("Academia")} value={formatCredits(dash.clubValue.academy)} />
        <Mini label={tr("Marca")} value={formatCredits(dash.clubValue.brand)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Prestigio multi-fuente */}
        <Panel title={tr("Prestigio — de dónde viene (Δ {v}{total}/temp.)", { v: bd.total >= 0 ? "+" : "", total: bd.total.toFixed(1) })}>
          <div className="space-y-1.5">
            {PRESTIGE_SOURCES.map(([k, label]) => {
              const v = (bd as unknown as Record<string, number>)[k];
              return (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-[11px] text-white/55">{td(label)}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div className={cn("h-full rounded-full", v >= 0 ? "bg-drl-cyan" : "bg-rose-500")} style={{ width: `${Math.min(100, Math.abs(v) / 4.5 * 100)}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-white/60">{v >= 0 ? "+" : ""}{v.toFixed(1)}</span>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* Organigrama */}
        <Panel title={tr("Organigrama (11 posiciones)")}>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <OrgRow label={tr("Head Coach")} name={career.coach.name} you />
            {dash.staff.map((m) => <OrgRow key={m.role} label={td(STAFF_LABEL[m.role])} name={`${m.name} (${m.rating})`} />)}
            {dash.vacancies.map((v) => <OrgRow key={v.key} label={td(v.label)} name={null} />)}
          </ul>
        </Panel>

        {/* Finanzas por líneas */}
        <Panel title={tr("Finanzas (última temporada)")}>
          {dash.lastLedger ? (
            <div className="grid grid-cols-2 gap-x-4 text-[12px]">
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-drl-cyan">{tr("Ingresos")}</p>
                {Object.entries(dash.lastLedger.income).map(([k, v]) => <Line key={k} label={td(k)} value={v} />)}
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-rose-400">{tr("Gastos")}</p>
                {Object.entries(dash.lastLedger.expenses).map(([k, v]) => <Line key={k} label={td(k)} value={v} />)}
              </div>
              <div className="col-span-2 mt-1.5 flex justify-between border-t border-white/10 pt-1.5 font-semibold text-white">
                <span>{tr("Balance neto")}</span><span className={dash.lastLedger.net < 0 ? "text-rose-400" : "text-emerald-400"}>{formatCredits(dash.lastLedger.net)}</span>
              </div>
            </div>
          ) : <p className="text-sm text-white/40">{tr("Sin datos económicos aún (cierra una temporada).")}</p>}
        </Panel>

        {/* Sponsors con personalidad */}
        <Panel title={tr("Patrocinadores")}>
          <ul className="space-y-1.5">
            {dash.sponsors.map((s) => (
              <li key={s.id} className="rounded-lg border border-white/10 bg-base-900/40 p-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">{s.name}</span>
                  <span className="text-[10px] uppercase text-white/35">{s.tier}</span>
                  <span className="ml-auto text-drl-cyan">{formatCredits(s.income)}/t</span>
                </div>
                <p className="mt-0.5 text-[11px] text-white/45">{s.personality ? td(SPONSOR_PERSONALITY_LABEL[s.personality]) : ""} {tr("· satisfacción")} {Math.round(s.satisfaction ?? 60)}</p>
              </li>
            ))}
            {dash.sponsors.length === 0 && <li className="text-sm text-white/40">{tr("Sin patrocinadores (fírmalos en Gestión).")}</li>}
          </ul>
        </Panel>
      </div>

      {/* Academia de cuerpo técnico */}
      <Panel title={tr("Academia de staff ({length})", { length: dash.academyStaff.length })}>
        {dash.academyStaff.length === 0 ? (
          <p className="text-sm text-white/40">{tr("La academia formará coaches/analistas/scouts al mejorar sus instalaciones.")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {dash.academyStaff.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-base-900/40 p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-white/80">{p.name} <span className="text-[11px] text-white/40">{td(STAFF_LABEL[p.role])}</span></p>
                  <p className="text-[11px] text-white/40">{tr("Rating {rating} · Pot. {potential} · {personality}", { rating: p.rating, potential: p.potential, personality: td(p.personality) })}</p>
                </div>
                <button onClick={() => promoteStaff(p.id)} className="shrink-0 rounded-md bg-drl px-2 py-1 text-[11px] font-bold text-white hover:brightness-110">{tr("Ascender")}</button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </section>
  );
}

function OrgRow({ label, name, you }: { label: string; name: string | null; you?: boolean }) {
  useLocale();
  return (
    <li className="flex items-center gap-2 rounded-lg border border-white/8 bg-base-900/40 px-2.5 py-1.5 text-[13px]">
      <span className="w-32 shrink-0 text-[11px] uppercase tracking-wide text-white/45">{td(label)}</span>
      {name ? <span className={cn("truncate", you ? "font-semibold text-drl-cyan" : "text-white/80")}>{name}{you && (" " + tr("(tú)"))}</span> : <span className="text-rose-400/70">{tr("Vacante")}</span>}
    </li>
  );
}
function Line({ label, value }: { label: string; value: number }) {
  useLocale();
  return <div className="flex justify-between text-white/60"><span className="capitalize text-white/45">{td(label)}</span><span>{formatCredits(value)}</span></div>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  useLocale();
  return (
    <section className="rounded-xl border border-white/10 bg-base-800/40 p-4">
      <h3 className="mb-2.5 font-display text-xs uppercase tracking-wider text-white/70">{td(title)}</h3>
      {children}
    </section>
  );
}
function Kpi({ label, value, big }: { label: string; value: string; big?: boolean }) {
  useLocale();
  return (
    <div className="rounded-lg border border-white/10 bg-base-900/50 px-3 py-1.5">
      <p className={cn("font-display font-bold text-white", big ? "text-base" : "text-sm")}>{td(value)}</p>
      <p className="text-[9px] uppercase tracking-wider text-white/40">{td(label)}</p>
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  useLocale();
  return (
    <div className="rounded-lg border border-white/5 bg-base-900/40 p-2 text-center">
      <p className="text-sm text-white/80">{td(value)}</p>
      <p className="text-[10px] uppercase tracking-wider text-white/40">{td(label)}</p>
    </div>
  );
}
