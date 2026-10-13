"use client";

/**
 * CLUB MANAGEMENT — panel de GENERAL MANAGER (Career Fase 3).
 *
 * Economía, instalaciones, staff, patrocinadores, academia y scouting del club. Conecta con
 * el Living World (presupuesto/roster reales) vía `useWorldStore`. Solo pinta lo que prepara
 * `clubDashboard` y dispara las acciones de gestión del store.
 */
import { useMemo } from "react";
import { useManagerStore } from "@/store/useManagerStore";
import { useWorldStore } from "@/store/useWorldStore";
import {
  clubDashboard, clubViewFor, FACILITY_LABEL, FACILITY_EFFECT_LABEL, upgradeCost,
  STAFF_LABEL, generateStaffCandidates, availableSponsors, MAX_FACILITY_LEVEL, makeRng, seedOf,
} from "@/career";
import { playerValue } from "@/world";
import { formatCredits, cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("career");

export function ClubManagement() {
  useLocale();
  const career = useManagerStore((s) => s.career)!;
  const world = useWorldStore((s) => s.world);
  const upgrade = useManagerStore((s) => s.upgradeFacility);
  const hire = useManagerStore((s) => s.hireStaff);
  const sign = useManagerStore((s) => s.signSponsor);
  const runScout = useManagerStore((s) => s.runScout);
  const promote = useManagerStore((s) => s.promoteProspect);

  const mgmt = career.management;
  const club = useMemo(() => (career.clubId && world ? clubViewFor(world, career.clubId) : null), [career.clubId, world]);
  const squadValue = useMemo(() => {
    if (!world || !career.clubId) return 0;
    const t = world.teams[career.clubId];
    return t ? t.roster.reduce((a, id) => a + (world.players[id] ? playerValue(world.players[id]) : 0), 0) : 0;
  }, [world, career.clubId]);

  if (!mgmt || !club) return null;
  const dash = clubDashboard(mgmt, club, squadValue);
  const staffCands = generateStaffCandidates(career.seed, career.season, makeRng(seedOf(career.seed, "staffmkt", career.season)));
  const sponsorOpts = availableSponsors(club, career, career.season, makeRng(seedOf(career.seed, "spmkt", career.season)));

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-base-800/50 p-5">
      <h2 className="font-display text-sm uppercase tracking-wider text-white/70">{tr("Gestión del club ·")} {club.name}</h2>

      {/* Economía */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Big label={tr("Saldo")} value={formatCredits(dash.balance)} accent={dash.balance < 0 ? "bad" : "good"} />
        <Big label={tr("Ingresos (últ.)")} value={formatCredits(dash.lastSeasonIncome)} />
        <Big label={tr("Gastos (últ.)")} value={formatCredits(dash.lastSeasonExpense)} />
        <Big label={tr("Balance neto")} value={formatCredits(dash.lastSeasonNet)} accent={dash.lastSeasonNet < 0 ? "bad" : "good"} />
      </div>
      <div className="grid gap-3 sm:grid-cols-4 text-sm">
        <Mini label={tr("Valor plantilla")} value={formatCredits(dash.squadValue)} />
        <Mini label={tr("Valor academia")} value={formatCredits(dash.academyValue)} />
        <Mini label={tr("Fanbase")} value={`${dash.fanbase}`} />
        <Mini label={tr("Prestigio")} value={`${Math.round(dash.prestige)}`} />
      </div>

      {/* Instalaciones */}
      <div>
        <p className="mb-2 font-display text-[11px] uppercase tracking-wider text-drl">{tr("Instalaciones")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {dash.facilities.map((f) => {
            const cost = upgradeCost(f.level);
            const maxed = f.level >= MAX_FACILITY_LEVEL;
            const affordable = dash.balance >= cost;
            return (
              <div key={f.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-base-900/40 p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white/80">{td(FACILITY_LABEL[f.id])}</p>
                  <p className="truncate text-[11px] text-white/40">{td(FACILITY_EFFECT_LABEL[f.id])}</p>
                  <div className="mt-1 flex gap-0.5">
                    {Array.from({ length: MAX_FACILITY_LEVEL }).map((_, i) => (
                      <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < f.level ? "bg-drl" : "bg-white/10")} />
                    ))}
                  </div>
                </div>
                <button
                  disabled={maxed || !affordable}
                  onClick={() => upgrade(f.id)}
                  className={cn("shrink-0 rounded-md px-2 py-1 text-[11px] font-bold", maxed ? "bg-white/5 text-white/30" : affordable ? "bg-drl text-white hover:brightness-110" : "bg-white/5 text-white/30")}
                >
                  {maxed ? tr("MÁX") : `▲ ${formatCredits(cost)}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Staff */}
        <div>
          <p className="mb-2 font-display text-[11px] uppercase tracking-wider text-drl">{tr("Staff")}</p>
          <div className="space-y-1.5">
            {staffCands.map((c) => {
              const hired = mgmt.staff.find((m) => m.role === c.role);
              return (
                <div key={c.role} className="flex items-center gap-2 rounded-lg border border-white/10 bg-base-900/40 p-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-white/75">{td(STAFF_LABEL[c.role])} {hired && <span className="text-drl-cyan">· {hired.name} ({hired.rating})</span>}</p>
                    <p className="text-[11px] text-white/40">{tr("Candidato: {name} ({rating}) · {salary}/año", { name: c.name, rating: c.rating, salary: formatCredits(c.salary) })}</p>
                  </div>
                  <button onClick={() => hire(c)} disabled={dash.balance < c.salary} className={cn("shrink-0 rounded-md px-2 py-1 text-[11px] font-bold", dash.balance >= c.salary ? "bg-drl text-white hover:brightness-110" : "bg-white/5 text-white/30")}>
                    {tr("Contratar")}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Patrocinadores */}
        <div>
          <p className="mb-2 font-display text-[11px] uppercase tracking-wider text-drl">{tr("Patrocinadores")}</p>
          <div className="space-y-1.5">
            {sponsorOpts.map((s) => {
              const active = mgmt.sponsors.find((x) => x.tier === s.tier);
              return (
                <div key={s.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-base-900/40 p-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-white/75">{s.name} <span className="text-[10px] uppercase text-white/35">{s.tier}</span></p>
                    <p className="text-[11px] text-white/40">+{formatCredits(s.income)}{tr("/año")}{s.objectivePosition ? tr(" · exige Top {objectivePosition}", { objectivePosition: s.objectivePosition }) : ""}{active ? (" " + tr("· activo")) : ""}</p>
                  </div>
                  <button onClick={() => sign(s)} className="shrink-0 rounded-md bg-drl px-2 py-1 text-[11px] font-bold text-white hover:brightness-110">{tr("Firmar")}</button>
                </div>
              );
            })}
            <p className="text-[11px] text-white/40">{tr("Ingreso por patrocinio: {amount}/año", { amount: formatCredits(dash.sponsorIncome) })}</p>
          </div>
        </div>
      </div>

      {/* Academia */}
      <div>
        <p className="mb-2 font-display text-[11px] uppercase tracking-wider text-drl">{tr("Academia (")}{dash.academyCount})</p>
        {dash.topProspects.length === 0 ? (
          <p className="text-sm text-white/40">{tr("Sin promesas todavía. Aparecerán al cerrar temporada.")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {dash.topProspects.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-base-900/40 p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-white/80">{p.name} <span className="text-[11px] text-white/40">{td(p.role)} · {p.age} {tr("años")}</span></p>
                  <p className="text-[11px] text-white/40">{tr("Pot.")} {p.potential} · {td(p.scout.recommendation)}</p>
                </div>
                <button onClick={() => promote(p.id)} className="shrink-0 rounded-md bg-drl px-2 py-1 text-[11px] font-bold text-white hover:brightness-110">{tr("Subir")}</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scouting */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="font-display text-[11px] uppercase tracking-wider text-drl">{tr("Scouting")}</p>
          <button onClick={runScout} className="rounded-md border border-white/10 bg-base-700/50 px-2.5 py-1 text-xs text-white/60 hover:text-white">{tr("Ojear el mercado")}</button>
        </div>
        {mgmt.scouting.length === 0 ? (
          <p className="text-sm text-white/40">{tr("Lanza una campaña de ojeo para descubrir talento.")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {mgmt.scouting.slice(0, 6).map((t) => (
              <div key={t.id} className="rounded-lg border border-white/10 bg-base-900/40 p-2 text-sm">
                <p className="truncate text-white/80">{t.name} <span className="text-[11px] text-white/40">{td(t.role)} · {td(t.region)}</span></p>
                <p className="text-[11px] text-white/40">{tr("Pot. {potential} · Coste {cost} · Riesgo {risk} · Comp. {compatibility}", { potential: t.potential, cost: formatCredits(t.cost), risk: t.risk, compatibility: t.compatibility })}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Big({ label, value, accent }: { label: string; value: string; accent?: "good" | "bad" }) {
  useLocale();
  return (
    <div className="rounded-xl border border-white/10 bg-base-900/50 px-3 py-2">
      <p className={cn("font-display text-xl font-bold", accent === "bad" ? "text-drl" : accent === "good" ? "text-drl-cyan" : "text-white")}>{td(value)}</p>
      <p className="text-[10px] uppercase tracking-wider text-white/40">{td(label)}</p>
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  useLocale();
  return (
    <div className="rounded-lg border border-white/5 bg-base-900/40 p-2">
      <p className="text-white/80">{td(value)}</p>
      <p className="text-[10px] uppercase tracking-wider text-white/40">{td(label)}</p>
    </div>
  );
}
