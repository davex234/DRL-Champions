"use client";

/**
 * DASHBOARD del LIVE ECOSYSTEM (admin). Una sola pantalla: estado, fuentes, pipeline en
 * vivo, métricas (analytics), logs, eventos, cartas y noticias generadas. Ejecuta el
 * orquestador canónico con proveedores mock (en local) — el mismo que correría un cron.
 * Solo MUESTRA; no duplica lógica.
 */
import { useMemo, useRef, useState } from "react";
import { ADMIN_ENABLED } from "@/config/admin";
import {
  makeMockProvider, defaultFixtures, runLiveCycle, createTimeline,
  type Timeline, type LiveCycleResult, type LiveDataProvider,
} from "@/live";
import { cn } from "@/lib/format";

export default function LiveDashboard() {
  const providers = useMemo<LiveDataProvider[]>(() => [
    makeMockProvider({ id: "flaky-vlr", priority: 100, healthy: false, tournaments: defaultFixtures() }),
    makeMockProvider({ id: "mock-primary", priority: 10, tournaments: defaultFixtures() }),
  ], []);
  const timeline = useRef<Timeline>(createTimeline());
  const [result, setResult] = useState<LiveCycleResult | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const r = await runLiveCycle(providers, timeline.current, {});
    setResult(r);
    setRunning(false);
  };
  const reset = () => { timeline.current = createTimeline(); setResult(null); };

  if (!ADMIN_ENABLED) {
    return <div className="rounded-2xl border border-white/10 bg-base-700/40 p-8 text-center text-white/60">Panel de administración deshabilitado (NEXT_PUBLIC_ADMIN=1 para activarlo).</div>;
  }

  const a = result?.analytics;
  return (
    <section className="animate-rise space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">Live <span className="text-drl">Ecosystem</span></h1>
          <p className="mt-1 text-white/50">Orquestador autónomo: torneos → cartas → noticias → mercado, todo solo.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={run} disabled={running}
            className="rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110 disabled:opacity-50">
            {running ? "Ejecutando…" : "▸ Ejecutar ciclo"}
          </button>
          <button onClick={reset} className="rounded-xl border border-white/15 px-4 py-2.5 font-display text-xs uppercase tracking-wide text-white/60 hover:bg-white/10">Reset</button>
        </div>
      </header>

      {/* Estado + fuentes */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card title="Estado">
          <p className="font-display text-lg font-bold text-white">{running ? "Sincronizando" : result ? "Inactivo" : "Listo"}</p>
          <p className="text-[11px] text-white/45">Última: {a ? `${a.durationMs} u · fuente ${a.providerUsed ?? "—"}` : "—"}</p>
          <p className="text-[11px] text-white/30">Próxima: cron no configurado (manual / endpoint)</p>
        </Card>
        <Card title="Fuentes (failover por prioridad)">
          {providers.map((p) => (
            <p key={p.id} className="flex justify-between text-[12px] text-white/65">
              <span>{p.id}</span><span className="text-white/35">prio {p.priority()}</span>
            </p>
          ))}
        </Card>
        <Card title="Intentos del ciclo">
          {a ? a.attempts.slice(0, 6).map((at, i) => (
            <p key={i} className="flex justify-between text-[11px]">
              <span className="text-white/55">{at.provider}·{at.method}</span>
              <span className={at.ok ? "text-emerald-300" : "text-rose-300"}>{at.ok ? "ok" : "fail"}</span>
            </p>
          )) : <p className="text-[11px] text-white/30">Ejecuta un ciclo.</p>}
        </Card>
      </div>

      {/* Métricas */}
      {a && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Metric label="Torneos" value={a.tournamentsProcessed} />
          <Metric label="Cartas" value={a.cardsCreated + a.cardsSpecial + a.cardsImproved} accent="#37e6a0" />
          <Metric label="Especiales" value={a.cardsSpecial} accent="#ffce4f" />
          <Metric label="Dups evitados" value={a.duplicatesAvoided} accent="#19e3ff" />
          <Metric label="Noticias" value={a.news} accent="#ff2e63" />
          <Metric label="Errores" value={a.errors.length} accent={a.errors.length ? "#ff4d6a" : "#7b8499"} />
        </div>
      )}

      {/* Pipeline log + paneles */}
      {result && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="Pipeline (log)">
            <div className="max-h-56 space-y-1 overflow-auto font-mono text-[10px] text-white/55">
              {result.logs.map((l, i) => <p key={i}>{l}</p>)}
            </div>
          </Card>
          <Card title="Eventos del universo">
            <div className="max-h-56 space-y-1 overflow-auto text-[12px]">
              {result.events.map((e) => (
                <p key={e.id} className="flex gap-2 text-white/65"><span className="text-drl">●</span>{e.detail}</p>
              ))}
            </div>
          </Card>
          <Card title={`Cartas generadas (${result.cards.length})`}>
            <div className="max-h-56 space-y-1 overflow-auto text-[12px]">
              {result.cards.map((c, i) => (
                <p key={i} className="flex justify-between text-white/70">
                  <span>{c.nick} · {c.family}</span>
                  <span><span className="text-white/40">{c.action}</span> · {c.tierLabel} {c.rating}</span>
                </p>
              ))}
            </div>
          </Card>
          <Card title={`Noticias (${result.news.length}) + Desafíos (${result.challenges.length})`}>
            <div className="max-h-56 space-y-1 overflow-auto text-[12px]">
              {result.news.map((n) => <p key={n.id} className="truncate text-white/70">📰 {n.title}</p>)}
              {result.challenges.map((c) => <p key={c.id} className="truncate text-amber-200/80">🎯 {c.title}</p>)}
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-base-700/40 p-4">
      <p className="mb-2 text-[10px] uppercase tracking-widest text-white/40">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
function Metric({ label, value, accent = "#e8eef5" }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-base-800/60 p-3 text-center">
      <p className="font-display text-2xl font-bold" style={{ color: accent }}>{value}</p>
      <p className="text-[9px] uppercase tracking-wide text-white/40">{label}</p>
    </div>
  );
}
