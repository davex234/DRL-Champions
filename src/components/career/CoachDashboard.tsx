"use client";

/**
 * COACH DASHBOARD — panel profesional del entrenador (Career Fase 2).
 *
 * Muestra estado de contrato, objetivos de directiva, confianza/presión, seguridad del
 * puesto, expectativa del club y ofertas activas. Conecta con el Living World vía
 * `useWorldStore` (clubes reales). Solo pinta lo que prepara `careerDashboard`.
 */
import { useMemo } from "react";
import { useManagerStore } from "@/store/useManagerStore";
import { useWorldStore } from "@/store/useWorldStore";
import { careerDashboard, clubViewFor, PHILOSOPHY_LABEL } from "@/career";
import { formatCredits, cn } from "@/lib/format";

export function CoachDashboard() {
  const career = useManagerStore((s) => s.career)!;
  const advanceSeason = useManagerStore((s) => s.advanceSeason);
  const acceptOffer = useManagerStore((s) => s.acceptOffer);
  const rejectOffer = useManagerStore((s) => s.rejectOffer);
  const refreshOffers = useManagerStore((s) => s.refreshOffers);
  const world = useWorldStore((s) => s.world);

  const club = useMemo(() => (career.clubId && world ? clubViewFor(world, career.clubId) : null), [career.clubId, world]);
  const dash = useMemo(() => careerDashboard(career, club), [career, club]);
  const pending = dash.pendingOffers;

  return (
    <section className="rounded-2xl border border-white/10 bg-base-800/50 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm uppercase tracking-wider text-white/70">Dashboard del entrenador</h2>
        <div className="flex gap-2">
          <button onClick={refreshOffers} className="rounded-md border border-white/10 bg-base-700/50 px-2.5 py-1 text-xs text-white/60 hover:text-white">Buscar ofertas</button>
          <button onClick={advanceSeason} className="rounded-md bg-drl px-3 py-1 text-xs font-bold text-white shadow-glow hover:brightness-110">Avanzar temporada ▸</button>
        </div>
      </div>

      {dash.employed ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Contrato */}
          <div className="rounded-xl border border-white/10 bg-base-900/40 p-4">
            <div className="flex items-center justify-between">
              <p className="font-display text-lg text-white">{dash.clubName}</p>
              {club && <span className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-white/55">{PHILOSOPHY_LABEL[club.philosophy]}</span>}
            </div>
            {dash.contract && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <Info label="Cargo" value={dash.contract.role} />
                <Info label="Años restantes" value={String(dash.contract.yearsLeft)} />
                <Info label="Salario/año" value={formatCredits(dash.contract.salary)} />
                <Info label="Cláusula" value={formatCredits(dash.contract.releaseClause)} />
                {dash.expectation && <Info label="Expectativa" value={`Top ${dash.expectation}`} />}
                <Info label="Estado" value={dash.contract.status} />
              </div>
            )}
            {/* Objetivos del contrato */}
            <p className="mt-3 mb-1 font-display text-[11px] uppercase tracking-wider text-drl">Objetivos del contrato</p>
            <ul className="space-y-1">
              {dash.objectives.map((o, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className={cn("h-2 w-2 rounded-full", o.status === "met" ? "bg-drl-cyan" : o.status === "failed" ? "bg-drl" : "bg-white/30")} />
                  <span className="text-white/70">{o.text}</span>
                  {o.mandatory && <span className="text-[10px] uppercase text-drl/70">obligatorio</span>}
                </li>
              ))}
            </ul>
          </div>

          {/* Relación con el entorno + seguridad del puesto */}
          <div className="rounded-xl border border-white/10 bg-base-900/40 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-display text-sm text-white/80">Estado del puesto</p>
              <span className={cn("text-xs font-bold", dash.jobSecurity >= 66 ? "text-drl" : dash.jobSecurity >= 33 ? "text-drl-gold" : "text-drl-cyan")}>
                {dash.jobSecurity >= 66 ? "En peligro" : dash.jobSecurity >= 33 ? "Bajo presión" : "Estable"}
              </span>
            </div>
            <RiskBar value={dash.jobSecurity / 100} />
            <div className="mt-3 space-y-2">
              <Meter label="Confianza directiva" value={dash.board.confidence} good />
              <Meter label="Presión" value={dash.board.pressure} />
              <Meter label="Apoyo de la afición" value={dash.board.fanSupport} good />
              <Meter label="Respeto del vestuario" value={dash.board.playerRespect} good />
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/15 bg-base-900/40 p-6 text-center">
          <p className="text-white/70">Estás <span className="text-drl">sin club</span>{dash.unemployedSeasons > 0 ? ` (${dash.unemployedSeasons} temporada(s))` : ""}.</p>
          <p className="mt-1 text-sm text-white/40">Acepta una oferta del mercado para volver a un banquillo.</p>
        </div>
      )}

      {/* Ofertas activas */}
      {pending.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 font-display text-[11px] uppercase tracking-wider text-drl">Ofertas activas ({pending.length})</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {pending.map((o) => (
              <div key={o.id} className="rounded-xl border border-white/10 bg-base-900/50 p-3">
                <div className="flex items-center justify-between">
                  <p className="font-display text-white">{o.clubName}</p>
                  <span className="text-[11px] text-white/45">{o.region} · Prestigio {o.prestige}</span>
                </div>
                <p className="mt-1 text-xs text-white/55">
                  {o.terms.years} temporadas · {formatCredits(o.terms.salary)}/año · {PHILOSOPHY_LABEL[o.philosophy]}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-drl-cyan to-drl" style={{ width: `${o.appeal}%` }} />
                  </div>
                  <span className="text-[10px] text-white/40">Atractivo {o.appeal}</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => acceptOffer(o.id)} className="flex-1 rounded-md bg-drl px-2 py-1 text-xs font-bold text-white hover:brightness-110">
                    {o.clubId === career.clubId ? "Renovar" : "Firmar"}
                  </button>
                  <button onClick={() => rejectOffer(o.id)} className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/50 hover:text-white">Rechazar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-white/35">{label}</p>
      <p className="text-white/80">{value}</p>
    </div>
  );
}
function Meter({ label, value, good = false }: { label: string; value: number; good?: boolean }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] text-white/50"><span>{label}</span><span>{Math.round(value)}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={cn("h-full rounded-full", good ? "bg-drl-cyan" : "bg-drl")} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}
function RiskBar({ value }: { value: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-gradient-to-r from-drl-cyan via-drl-gold to-drl" style={{ width: `${Math.max(4, Math.min(100, value * 100))}%` }} />
    </div>
  );
}
