"use client";

/**
 * DASHBOARD del LIVE ECOSYSTEM (admin). Una sola pantalla: estado, fuentes, pipeline en
 * vivo, métricas (analytics), logs, eventos, cartas y noticias generadas. Ejecuta el
 * orquestador canónico con proveedores mock (en local) — el mismo que correría un cron.
 * Solo MUESTRA; no duplica lógica.
 */
import { useMemo, useRef, useState } from "react";
import {
  makeMockProvider, defaultFixtures, runLiveCycle, createTimeline,
  type Timeline, type LiveCycleResult, type LiveDataProvider,
} from "@/live";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

export default function LiveDashboard() {
  useLocale();
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

  const a = result?.analytics;
  return (
    <section className="animate-rise space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">{t("Live")} <span className="text-drl">{t("Ecosystem")}</span></h1>
          <p className="mt-1 text-white/50">{t("Orquestador autónomo: torneos → cartas → noticias → mercado, todo solo.")}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={run} disabled={running}
            className="rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110 disabled:opacity-50">
            {running ? t("Ejecutando…") : t("▸ Ejecutar ciclo")}
          </button>
          <button onClick={reset} className="rounded-xl border border-white/15 px-4 py-2.5 font-display text-xs uppercase tracking-wide text-white/60 hover:bg-white/10">{t("Reset")}</button>
        </div>
      </header>

      {/* Estado + fuentes */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card title={t("Estado")}>
          <p className="font-display text-lg font-bold text-white">{running ? t("Sincronizando") : result ? t("Inactivo") : t("Listo")}</p>
          <p className="text-[11px] text-white/45">{t("Última:")} {a ? t("{durationMs} u · fuente {v}", { durationMs: a.durationMs, v: td(a.providerUsed) ?? "—" }) : "—"}</p>
          <p className="text-[11px] text-white/30">{t("Próxima: cron no configurado (manual / endpoint)")}</p>
        </Card>
        <Card title={t("Fuentes (failover por prioridad)")}>
          {providers.map((p) => (
            <p key={p.id} className="flex justify-between text-[12px] text-white/65">
              <span>{p.id}</span><span className="text-white/35">{t("prio")} {p.priority()}</span>
            </p>
          ))}
        </Card>
        <Card title={t("Intentos del ciclo")}>
          {a ? a.attempts.slice(0, 6).map((at, i) => (
            <p key={i} className="flex justify-between text-[11px]">
              <span className="text-white/55">{td(at.provider)}·{td(at.method)}</span>
              <span className={at.ok ? "text-emerald-300" : "text-rose-300"}>{at.ok ? t("ok") : t("fail")}</span>
            </p>
          )) : <p className="text-[11px] text-white/30">{t("Ejecuta un ciclo.")}</p>}
        </Card>
      </div>

      {/* Métricas */}
      {a && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Metric label={t("Torneos")} value={a.tournamentsProcessed} />
          <Metric label={t("Cartas")} value={a.cardsCreated + a.cardsSpecial + a.cardsImproved} accent="#37e6a0" />
          <Metric label={t("Especiales")} value={a.cardsSpecial} accent="#ffce4f" />
          <Metric label={t("Dups evitados")} value={a.duplicatesAvoided} accent="#19e3ff" />
          <Metric label={t("Noticias")} value={a.news} accent="#ff2e63" />
          <Metric label={t("Errores")} value={a.errors.length} accent={a.errors.length ? "#ff4d6a" : "#7b8499"} />
        </div>
      )}

      {/* Pipeline log + paneles */}
      {result && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title={t("Pipeline (log)")}>
            <div className="max-h-56 space-y-1 overflow-auto font-mono text-[10px] text-white/55">
              {result.logs.map((l, i) => <p key={i}>{td(l)}</p>)}
            </div>
          </Card>
          <Card title={t("Eventos del universo")}>
            <div className="max-h-56 space-y-1 overflow-auto text-[12px]">
              {result.events.map((e) => (
                <p key={e.id} className="flex gap-2 text-white/65"><span className="text-drl">●</span>{td(e.detail)}</p>
              ))}
            </div>
          </Card>
          <Card title={t("Cartas generadas ({length})", { length: result.cards.length })}>
            <div className="max-h-56 space-y-1 overflow-auto text-[12px]">
              {result.cards.map((c, i) => (
                <p key={i} className="flex justify-between text-white/70">
                  <span>{c.nick} · {td(c.family)}</span>
                  <span><span className="text-white/40">{c.action}</span> · {td(c.tierLabel)} {c.rating}</span>
                </p>
              ))}
            </div>
          </Card>
          <Card title={t("Noticias ({length}) + Desafíos ({length2})", { length: result.news.length, length2: result.challenges.length })}>
            <div className="max-h-56 space-y-1 overflow-auto text-[12px]">
              {result.news.map((n) => <p key={n.id} className="truncate text-white/70">📰 {td(n.title)}</p>)}
              {result.challenges.map((c) => <p key={c.id} className="truncate text-amber-200/80">🎯 {td(c.title)}</p>)}
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  useLocale();
  return (
    <div className="rounded-2xl border border-white/10 bg-base-700/40 p-4">
      <p className="mb-2 text-[10px] uppercase tracking-widest text-white/40">{td(title)}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
function Metric({ label, value, accent = "#e8eef5" }: { label: string; value: number; accent?: string }) {
  useLocale();
  return (
    <div className="rounded-xl border border-white/10 bg-base-800/60 p-3 text-center">
      <p className="font-display text-2xl font-bold" style={{ color: accent }}>{value}</p>
      <p className="text-[9px] uppercase tracking-wide text-white/40">{td(label)}</p>
    </div>
  );
}
