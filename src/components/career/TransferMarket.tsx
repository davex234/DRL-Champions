"use client";

/**
 * MERCADO DE FICHAJES — dashboard profesional del director deportivo (Career Fase 4/7).
 *
 * SOLO pinta: el estado lo prepara `marketBroadcast` (motor puro `@/market`) y las acciones
 * las orquesta `useManagerStore`. Muestra plantilla (titulares/suplentes/cedidos), necesidades,
 * objetivos ojeados, negociaciones (oferta/contra/aceptación), ofertas entrantes, cesiones,
 * rumores, finanzas del mercado y el registro de la ventana.
 */
import { useEffect, useMemo, useState } from "react";
import { useManagerStore } from "@/store/useManagerStore";
import { useWorldStore } from "@/store/useWorldStore";
import { marketBroadcast, loanDestinations, type MarketTarget, type PlayerOffer, type SquadPlayerView } from "@/market";
import { formatCredits, cn } from "@/lib/format";

const STATUS_LABEL: Record<string, string> = { protected: "Intransferible", normal: "Normal", listed: "Transferible", loan_listed: "Cedible" };
const BAND_COLOR: Record<string, string> = { joven: "text-drl-cyan", prime: "text-emerald-400", veterano: "text-amber-400", declive: "text-rose-400" };

export function TransferMarket() {
  const career = useManagerStore((s) => s.career);
  const window = useManagerStore((s) => s.window);
  const world = useWorldStore((s) => s.world);
  const {
    openMarket, marketOffer, marketAcceptCounter, marketCounter, marketRespond,
    marketRenew, marketRelease, marketLoanOut, marketSetStatus, marketSetLineup,
  } = useManagerStore.getState();

  // Abre / reconstruye la ventana para la temporada actual.
  useEffect(() => {
    if (!career?.clubId) return;
    if (!window || window.clubId !== career.clubId || window.season !== career.season || !window.open) openMarket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [career?.clubId, career?.season]);

  const dash = useMemo(() => (world && window ? marketBroadcast(window, world) : null), [world, window]);
  if (!career?.clubId || !dash || !dash.squad) return null;
  const sq = dash.squad;

  return (
    <section className="space-y-5 rounded-2xl border border-drl/20 bg-gradient-to-br from-base-800/60 to-base-900/70 p-5">
      <header className="flex flex-wrap items-center gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-drl/30 bg-drl/10 text-2xl">💱</div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold text-white">Mercado de Fichajes</h2>
          <p className="text-xs text-white/50">{dash.stance.message}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Kpi label="Presupuesto" value={formatCredits(dash.budget)} />
          <Kpi label="Valor plantilla" value={formatCredits(sq.squadValue)} />
          <Kpi label="Masa salarial" value={formatCredits(sq.wageBill)} />
        </div>
      </header>

      {/* Necesidades + química */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-white/40">Necesidades:</span>
        {sq.needs.slice(0, 5).map((n, i) => (
          <span key={i} className="rounded-md bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-300">{n.reason} · {n.severity}</span>
        ))}
        <span className="ml-auto rounded-md bg-drl/15 px-2 py-0.5 text-[11px] text-drl">Química {sq.chemistry} · Edad media {sq.avgAge}</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Plantilla ── */}
        <Panel title={`Plantilla — ${sq.clubName}`}>
          <SquadGroup title="Titulares" players={sq.starters} onRenew={marketRenew} onRelease={marketRelease} onStatus={marketSetStatus} />
          {sq.bench.length > 0 && <SquadGroup title="Suplentes" players={sq.bench} onRenew={marketRenew} onRelease={marketRelease} onStatus={marketSetStatus} onPromote={(id) => marketSetLineup([id, ...sq.starters.slice(0, 4).map((p) => p.id)])} onLoan={(id) => loanFirst(id)} />}
          {sq.loanedOut.length > 0 && <SquadGroup title="Cedidos" players={sq.loanedOut} />}
        </Panel>

        {/* ── Objetivos ── */}
        <Panel title="Objetivos ojeados">
          <ul className="space-y-2">
            {dash.targets.slice(0, 8).map((t) => (
              <TargetRow key={t.id} t={t} onSign={() => marketOffer(t.id, { fee: t.askingFee, salary: t.wageDemand, years: 3 })} onBid={(fee, salary) => marketOffer(t.id, { fee, salary, years: 3 })} />
            ))}
            {dash.targets.length === 0 && <li className="text-sm text-white/40">Sin objetivos por ahora.</li>}
          </ul>
        </Panel>

        {/* ── Negociaciones (salientes) ── */}
        <Panel title="Negociaciones">
          <ul className="space-y-2">
            {dash.outgoing.map((o) => (
              <OfferRow key={o.id} o={o} onAccept={() => marketAcceptCounter(o.id)} onRaise={() => marketCounter(o.id, { fee: Math.round(o.fee * 1.1), salary: o.salary, years: o.years })} />
            ))}
            {dash.outgoing.length === 0 && <li className="text-sm text-white/40">Sin negociaciones abiertas.</li>}
          </ul>
        </Panel>

        {/* ── Ofertas entrantes (ventas) ── */}
        <Panel title="Ofertas por tus jugadores">
          <ul className="space-y-2">
            {dash.incoming.map((o) => (
              <li key={o.id} className="rounded-lg border border-white/10 bg-base-900/40 p-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">{o.playerNick}</span>
                  <span className="text-white/40">← {o.toClubName}</span>
                  <span className="ml-auto font-display text-drl-cyan">{formatCredits(o.fee)}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-white/45">{o.note}</p>
                {o.status !== "accepted" && o.status !== "rejected" && (
                  <div className="mt-1.5 flex gap-1.5">
                    <MiniBtn onClick={() => marketRespond(o.id, "accept")} tone="go">Vender</MiniBtn>
                    <MiniBtn onClick={() => marketRespond(o.id, "counter", Math.round(o.fee * 1.2))}>Pedir +20%</MiniBtn>
                    <MiniBtn onClick={() => marketRespond(o.id, "reject")} tone="no">Rechazar</MiniBtn>
                  </div>
                )}
                {o.status === "accepted" && <p className="mt-1 text-[11px] text-emerald-400">✓ Vendido</p>}
                {o.status === "rejected" && <p className="mt-1 text-[11px] text-rose-400">✕ Rechazada</p>}
              </li>
            ))}
            {dash.incoming.length === 0 && <li className="text-sm text-white/40">Ningún club puja por tus jugadores.</li>}
          </ul>
        </Panel>
      </div>

      {/* ── Rumores + finanzas + registro ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Rumores de mercado">
          <ul className="space-y-1.5">
            {dash.rumors.slice(0, 6).map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-[13px] text-white/60"><span className={cn("mt-0.5", r.heat > 65 ? "text-rose-400" : "text-white/30")}>●</span>{r.text}</li>
            ))}
            {dash.rumors.length === 0 && <li className="text-sm text-white/40">Mercado tranquilo.</li>}
          </ul>
        </Panel>
        <Panel title="Balance de la ventana">
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Gastado" value={formatCredits(dash.spent)} />
            <Kpi label="Ingresado" value={formatCredits(dash.earned)} />
          </div>
          <p className="mt-2 text-[11px] text-white/40">{dash.loans.length} cesión(es) activa(s)</p>
        </Panel>
        <Panel title="Actividad reciente">
          <ul className="space-y-1.5">
            {dash.log.slice(0, 6).map((e) => (
              <li key={e.id} className="text-[13px] text-white/55">{e.detail}</li>
            ))}
            {dash.log.length === 0 && <li className="text-sm text-white/40">Sin movimientos aún.</li>}
          </ul>
        </Panel>
      </div>
    </section>
  );

  function loanFirst(playerId: string) {
    const dests = world && window ? loanDestinations(world, window, playerId) : [];
    if (dests.length) marketLoanOut(playerId, dests[0].id, { seasons: 1, wageShare: 0.5, buyOption: null, buyBackClause: null, guaranteedMinutes: 70 });
  }
}

// ─────────────────────────── Subcomponentes ───────────────────────────

function SquadGroup({ title, players, onRenew, onRelease, onStatus, onPromote, onLoan }: {
  title: string; players: SquadPlayerView[];
  onRenew?: (id: string, salary: number, years: number) => void;
  onRelease?: (id: string) => void;
  onStatus?: (id: string, status: "protected" | "normal" | "listed" | "loan_listed") => void;
  onPromote?: (id: string) => void;
  onLoan?: (id: string) => void;
}) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-drl">{title}</p>
      <ul className="space-y-1.5">
        {players.map((p) => (
          <li key={p.id} className="rounded-lg border border-white/8 bg-base-900/40 p-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-semibold text-white">{p.nick}</span>
              <span className="text-[11px] text-white/40">{p.role} · {p.age}a</span>
              <span className={cn("text-[11px]", BAND_COLOR[p.band])}>{p.band}</span>
              <span className="ml-auto font-display text-white/80">OVR {p.rating}</span>
              <span className="text-[11px] text-drl-cyan">{formatCredits(p.value)}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-white/40">
              <span>💰 {formatCredits(p.wage)}/t</span><span>📄 {p.contractYears}a</span><span>😊 {p.happiness}</span>
              {p.loanInfo && <span className="text-amber-400">{p.loanInfo}</span>}
              {onStatus && <span className="ml-auto">{STATUS_LABEL[p.status]}</span>}
            </div>
            {(onRenew || onRelease || onStatus || onPromote || onLoan) && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {onPromote && <MiniBtn onClick={() => onPromote(p.id)} tone="go">Titular</MiniBtn>}
                {onRenew && <MiniBtn onClick={() => onRenew(p.id, Math.round(p.value * 0.15), 3)}>Renovar</MiniBtn>}
                {onStatus && <MiniBtn onClick={() => onStatus(p.id, p.status === "listed" ? "normal" : "listed")}>{p.status === "listed" ? "Quitar venta" : "Transferible"}</MiniBtn>}
                {onStatus && <MiniBtn onClick={() => onStatus(p.id, p.status === "protected" ? "normal" : "protected")}>{p.status === "protected" ? "Liberar bloqueo" : "Intransferible"}</MiniBtn>}
                {onLoan && <MiniBtn onClick={() => onLoan(p.id)}>Ceder</MiniBtn>}
                {onRelease && <MiniBtn onClick={() => onRelease(p.id)} tone="no">Liberar</MiniBtn>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TargetRow({ t, onSign, onBid }: { t: MarketTarget; onSign: () => void; onBid: (fee: number, salary: number) => void }) {
  return (
    <li className="rounded-lg border border-white/10 bg-base-900/40 p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-semibold text-white">{t.nick}</span>
        <span className="text-[11px] text-white/40">{t.role} · {t.age}a · {t.teamName}</span>
        <span className="ml-auto font-display text-white/80">OVR {t.rating}</span>
        <span className="text-[11px] text-white/40">POT {t.potential}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-white/45">
        <span>Valor {formatCredits(t.value)}</span>
        <span className="text-drl-cyan">Pide {formatCredits(t.askingFee)}</span>
        <span>Sueldo {formatCredits(t.wageDemand)}</span>
        <span>Fit {t.fit}</span><span>Quím {t.chemistry}</span>
        {t.rumor && <span className="text-amber-400">{t.rumor}</span>}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <MiniBtn onClick={onSign} tone="go">Ofertar cláusula</MiniBtn>
        <MiniBtn onClick={() => onBid(Math.round(t.value * 0.9), t.wageDemand)}>Puja por valor</MiniBtn>
      </div>
    </li>
  );
}

function OfferRow({ o, onAccept, onRaise }: { o: PlayerOffer; onAccept: () => void; onRaise: () => void }) {
  const last = o.rounds[o.rounds.length - 1];
  return (
    <li className="rounded-lg border border-white/10 bg-base-900/40 p-2.5 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-white">{o.playerNick}</span>
        <span className="text-white/40">→ {o.fromClubName}</span>
        <span className="ml-auto font-display text-drl-cyan">{formatCredits(o.fee)}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-white/45">{last?.by === "ai" ? "🗣️ " : "→ "}{last?.note}</p>
      {o.status === "countered" && (
        <div className="mt-1.5 flex gap-1.5">
          <MiniBtn onClick={onAccept} tone="go">Aceptar {formatCredits(o.fee)}</MiniBtn>
          <MiniBtn onClick={onRaise}>Subir 10%</MiniBtn>
        </div>
      )}
      {o.status === "accepted" && <p className="mt-1 text-[11px] text-emerald-400">✓ Fichado</p>}
      {o.status === "rejected" && <p className="mt-1 text-[11px] text-rose-400">✕ Rechazada</p>}
      {o.status === "pending" && <p className="mt-1 text-[11px] text-white/40">Esperando respuesta…</p>}
    </li>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-base-800/40 p-4">
      <h3 className="mb-2.5 font-display text-xs uppercase tracking-wider text-white/70">{title}</h3>
      {children}
    </section>
  );
}
function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-base-900/50 px-3 py-1.5">
      <p className="font-display text-sm font-bold text-white">{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-white/40">{label}</p>
    </div>
  );
}
function MiniBtn({ children, onClick, tone }: { children: React.ReactNode; onClick: () => void; tone?: "go" | "no" }) {
  return (
    <button onClick={onClick} className={cn(
      "rounded-md px-2 py-1 text-[11px] font-semibold transition hover:brightness-110",
      tone === "go" ? "bg-drl/80 text-white" : tone === "no" ? "bg-rose-500/20 text-rose-300" : "bg-white/8 text-white/70",
    )}>{children}</button>
  );
}
