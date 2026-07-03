"use client";

/**
 * EL MUNDO — el ecosistema de esports VIVO. Muestra standings, rankings, transferencias,
 * el periódico, los campeones y la crónica histórica. El usuario puede avanzar 1 o N
 * temporadas y volver a un universo distinto. Solo CONECTA el motor `@/world` vía store.
 */
import { useEffect, useState } from "react";
import { useWorldStore } from "@/store/useWorldStore";
import type { WorldBroadcast } from "@/world";
import { cn } from "@/lib/format";

const EVENT_LABEL: Record<string, string> = {
  historic_dynasty: "Dinastía", great_collapse: "Colapso", transfer_bomb: "Bombazo", retirement: "Retiro",
  academy_wonderkid: "Wonderkid", legend_created: "Leyenda", historic_rivalry: "Clásico", golden_generation: "Generación dorada",
  the_next_star: "Próxima estrella", the_last_dance: "Último baile", coach_fired: "Cese", coach_hired: "Nuevo coach",
  record_transfer: "Récord", perfect_season: "Temporada perfecta", perfect_split: "Split perfecto", historic_comeback: "Remontada",
};

export default function MundoPage() {
  const ensure = useWorldStore((s) => s.ensure);
  const advance = useWorldStore((s) => s.advance);
  const simulate = useWorldStore((s) => s.simulate);
  const reset = useWorldStore((s) => s.reset);
  const world = useWorldStore((s) => s.world);
  const [bc, setBc] = useState<WorldBroadcast | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { ensure(); }, [ensure]);
  useEffect(() => { setBc(useWorldStore.getState().view()); }, [world]);

  const run = (fn: () => void) => { setBusy(true); fn(); setTimeout(() => setBusy(false), 50); };

  return (
    <section className="animate-rise space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">El <span className="text-drl">Mundo</span> · Temporada {bc?.season ?? 1}</h1>
          <p className="mt-1 text-white/50">El ecosistema sigue vivo aunque no juegues. <strong className="text-white/70">Cada universo es irrepetible.</strong></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => run(advance)} disabled={busy}
            className="rounded-lg bg-gradient-to-r from-drl to-[#7b1733] px-4 py-2 font-display text-xs font-bold uppercase tracking-wide text-white shadow-glow transition enabled:hover:brightness-110 disabled:opacity-40">
            Avanzar temporada ▸
          </button>
          <button onClick={() => run(() => simulate(5))} disabled={busy}
            className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2 font-display text-xs uppercase tracking-wide text-amber-200 transition enabled:hover:bg-amber-400/20 disabled:opacity-40">
            Simular 5 ▸
          </button>
          <button onClick={() => run(() => reset())} disabled={busy}
            className="rounded-lg border border-white/15 px-4 py-2 font-display text-xs uppercase tracking-wide text-white/60 transition hover:bg-white/10">
            Reiniciar
          </button>
        </div>
      </header>

      {!bc ? (
        <p className="text-white/50">Cargando universo…</p>
      ) : (
        <>
          {/* Resumen */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {([["Equipos", bc.counts.teams], ["Jugadores", bc.counts.activePlayers], ["Retirados", bc.counts.retired], ["Agentes libres", bc.counts.freeAgents], ["Coaches", bc.counts.coaches]] as [string, number][]).map(([k, v]) => (
              <div key={k} className="rounded-xl border border-white/10 bg-base-800/60 px-3 py-2">
                <p className="text-[9px] uppercase tracking-widest text-white/40">{k}</p>
                <p className="font-display text-lg font-bold text-white">{v}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            {/* Standings */}
            <Panel title="Clasificación">
              <div className="space-y-1">
                {bc.standings.slice(0, 12).map((t) => (
                  <div key={t.id} className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5">
                    <span className="w-5 text-center font-display text-xs text-white/40">{t.pos}</span>
                    <span className="flex-1 truncate font-display text-sm font-bold text-white">{t.name}</span>
                    <span className="text-[10px] text-white/40">{t.region}</span>
                    <span className="w-12 text-right text-[11px] tabular-nums text-white/60">{t.wins}-{t.losses}</span>
                    <span className="w-10 text-right text-[10px] text-amber-300" title="títulos">★{t.titles}</span>
                    <span className="w-12 text-right text-[10px] text-drl" title="prestigio">{t.prestige}</span>
                  </div>
                ))}
              </div>
            </Panel>

            {/* Periódico */}
            <Panel title="Periódico">
              {bc.recentNews.length === 0 ? <p className="text-[12px] text-white/40">Aún sin titulares. Avanza una temporada.</p> : (
                <ul className="space-y-1.5">
                  {bc.recentNews.slice(0, 8).map((n) => (
                    <li key={n.id} className="border-l-2 border-drl/40 pl-2">
                      <p className="font-display text-[12px] font-bold uppercase tracking-wide text-white">{n.title}</p>
                      <p className="text-[11px] text-white/50">{n.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Ranking title="Top jugadores" rows={bc.rankings.players} />
            <Ranking title="Promesas" rows={bc.rankings.promises} />
            <Ranking title="Veteranos" rows={bc.rankings.veterans} />
            <Ranking title="Top equipos" rows={bc.rankings.teams} />
            <Ranking title="Top coaches" rows={bc.rankings.coaches} />
            <Ranking title="Regiones" rows={bc.rankings.regions} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Transferencias */}
            <Panel title="Mercado de fichajes">
              {bc.recentTransfers.length === 0 ? <p className="text-[12px] text-white/40">Sin movimientos recientes.</p> : (
                <ul className="space-y-1">
                  {bc.recentTransfers.slice(0, 10).map((t, i) => (
                    <li key={i} className="flex items-center gap-2 text-[12px]">
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white/50">{t.kind}</span>
                      <span className="font-semibold text-white">{t.nick}</span>
                      <span className="text-white/40">{t.from ? "" : "→"} {t.to ? "ficha" : "libre"}</span>
                      {t.fee > 0 && <span className="ml-auto text-drl-cyan">{t.fee.toLocaleString()}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/* Crónica + hitos */}
            <Panel title="Crónica histórica">
              <ul className="space-y-1">
                {bc.chronicle.map((c, i) => <li key={i} className="text-[12px] text-white/70">📜 {c}</li>)}
              </ul>
              {bc.recentEvents.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1 border-t border-white/10 pt-2">
                  {bc.recentEvents.slice(0, 8).map((e, i) => (
                    <span key={i} className="rounded bg-drl/15 px-1.5 py-0.5 font-display text-[9px] uppercase tracking-wide text-drl" title={e.detail}>
                      {EVENT_LABEL[e.type] ?? e.type}
                    </span>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-base-700/30 p-4">
      <p className="mb-2 font-display text-[11px] uppercase tracking-widest text-white/45">{title}</p>
      {children}
    </div>
  );
}

function Ranking({ title, rows }: { title: string; rows: { id: string; name: string; value: number; detail?: string }[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-base-800/60 p-3">
      <p className="mb-1.5 font-display text-[10px] uppercase tracking-widest text-drl">{title}</p>
      <ol className="space-y-0.5">
        {rows.slice(0, 6).map((r, i) => (
          <li key={r.id} className="flex items-center gap-2 text-[11px]">
            <span className="w-4 text-white/30">{i + 1}</span>
            <span className="flex-1 truncate text-white/80">{r.name}</span>
            {r.detail && <span className="truncate text-[9px] text-white/35">{r.detail}</span>}
            <span className="tabular-nums text-white/50">{r.value}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="text-[11px] text-white/30">—</li>}
      </ol>
    </div>
  );
}
