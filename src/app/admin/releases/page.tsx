"use client";

/**
 * RELEASE DASHBOARD (/admin/releases) — centro de control de publicación (Fase 4/7).
 * Capa de VISUALIZACIÓN pura: consume `/api/admin/releases`, que agrega los JSON ya generados
 * (pipeline-state · publish · history · release · report) y el estado real de los providers
 * (Transport Engine). No publica, no ejecuta rollback, no toca el pipeline.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { adminFetch, adminDownload } from "@/lib/supabase/adminClient";
import { cn } from "@/lib/format";
import type {
  DashboardData, ReleaseEntry, ProviderStatus, HealthItem, HealthLevel, ReleaseStatus, DistributionData,
} from "@/server/releases/types";
import { ns, td as i18nTd, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const i18nT = ns("admin");

const CHANNELS = ["all", "stable", "beta", "developer", "nightly"] as const;
type ChannelFilter = (typeof CHANNELS)[number];

// Orden canónico de fases para el stepper (solo etiquetas; el estado real viene del JSON).
const PHASE_ORDER: { key: string; label: string }[] = [
  { key: "queued", label: "Queued" },
  { key: "running", label: "Running" },
  { key: "building", label: "Building" },
  { key: "signing", label: "Signing" },
  { key: "manifests", label: "Manifests" },
  { key: "uploading", label: "Uploading" },
  { key: "verifying", label: "Verifying" },
  { key: "published", label: "Published" },
  { key: "ready", label: "Ready" },
];

// ── formato ──
const fmtBytes = (n: number | null | undefined): string => {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};
const fmtMs = (n: number | null | undefined): string => (n == null ? "—" : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);
const fmtDate = (s: string | null): string => {
  if (!s) return "—";
  try { return new Date(s).toLocaleString(getIntlLocale(), { dateStyle: "short", timeStyle: "short" }); } catch { return s; }
};
const shortHash = (h: string | null | undefined): string => (h ? `${h.slice(0, 10)}…` : "—");

const STATUS_STYLE: Record<ReleaseStatus, string> = {
  published: "bg-emerald-400/15 text-emerald-300 border-emerald-400/30",
  ready: "bg-drl-cyan/15 text-drl-cyan border-drl-cyan/30",
  failed: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  building: "bg-amber-400/15 text-amber-200 border-amber-400/30",
  queued: "bg-white/10 text-white/60 border-white/15",
  unknown: "bg-white/5 text-white/40 border-white/10",
};
const DOT: Record<HealthLevel, string> = { green: "🟢", yellow: "🟡", red: "🔴", off: "⚪" };

export default function ReleasesDashboardPage() {
  return <Dashboard />;
}

function Dashboard() {
  useLocale();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReleaseEntry | null>(null);
  const [rollbackFor, setRollbackFor] = useState<ReleaseEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await adminFetch("/api/admin/releases", { cache: "no-store" });
      if (!res.ok) throw new Error(`API ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const releases = data?.releases ?? [];
  const filtered = useMemo(() => releases.filter((r) => {
    if (channel !== "all" && r.channel !== channel) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (providerFilter !== "all" && (r.provider ?? "—") !== providerFilter) return false;
    if (query && !`${r.version} ${r.full} ${r.channel} ${r.commit ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [releases, channel, statusFilter, providerFilter, query]);

  const providersInData = useMemo(() => [...new Set(releases.map((r) => r.provider).filter(Boolean) as string[])], [releases]);

  return (
    <section className="animate-rise space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
            {i18nT("Release")} <span className="text-drl">{i18nT("Dashboard")}</span>
          </h1>
          <p className="mt-1 text-white/50">
            {i18nT("Centro de control de publicación · provider activo:")}{" "}
            <span className="font-display uppercase text-drl-cyan">{data?.activeProvider ?? "—"}</span>
            {data && <span className="ml-2 text-white/30">{i18nT("actualizado {fecha}", { fecha: fmtDate(data.generatedAt) })}</span>}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="rounded-xl border border-white/15 px-4 py-2.5 font-display text-xs uppercase tracking-wide text-white/70 transition hover:bg-white/10 disabled:opacity-50">
          {loading ? i18nT("Cargando…") : i18nT("↻ Refrescar")}
        </button>
      </header>

      {error && <Banner tone="error">{fill(i18nT("No se pudo leer el dashboard: {error}. ¿Has ejecutado {comando}?", { error: i18nTd(error), ...slots("comando") }), { comando: <code>npm run ci:pipeline</code> })}</Banner>}
      {!loading && data && !data.hasData && <Banner tone="warn">{fill(i18nT("No hay releases todavía. Ejecuta {comando} para generar y publicar una.", slots("comando")), { comando: <code>npm run ci:pipeline</code> })}</Banner>}

      {data && (
        <>
          <StatsStrip data={data} />
          <PipelineStepper data={data} />
          <HealthGrid items={data.health} />
          <ProvidersRow providers={data.providers} />
          <DistributionMap distribution={data.distribution} />

          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg border border-white/10 bg-base-800 p-0.5">
              {CHANNELS.map((c) => (
                <button key={c} onClick={() => setChannel(c)}
                  className={cn("rounded-md px-3 py-1 font-display text-xs uppercase tracking-wide transition", channel === c ? "bg-drl text-white" : "text-white/50 hover:text-white")}>
                  {c === "all" ? i18nT("Todos") : c}
                </button>
              ))}
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
              <option value="all">{i18nT("Estado: todos")}</option>
              {["published", "ready", "failed", "building", "queued", "unknown"].map((s) => <option key={s} value={s}>{i18nTd(s)}</option>)}
            </select>
            <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className={selectCls}>
              <option value="all">{i18nT("Provider: todos")}</option>
              {providersInData.map((p) => <option key={p} value={p}>{i18nTd(p)}</option>)}
            </select>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={i18nT("Buscar versión / commit…")}
              className="flex-1 min-w-[160px] rounded-lg border border-white/10 bg-base-800 px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-drl focus:outline-none" />
            <span className="text-xs text-white/40">{filtered.length}/{releases.length}</span>
          </div>

          <ReleasesTable releases={filtered} onSelect={setSelected} onRollback={setRollbackFor} />
          <TimelinePanel data={data} />
        </>
      )}

      <AnimatePresence>
        {selected && <DetailDrawer release={selected} onClose={() => setSelected(null)} onRollback={(r) => { setSelected(null); setRollbackFor(r); }} />}
        {rollbackFor && (
          <RollbackModal
            target={rollbackFor}
            current={releases.find((x) => x.channel === rollbackFor.channel && x.isCurrent) ?? null}
            allReleases={releases}
            onClose={() => setRollbackFor(null)}
            onDone={() => { setRollbackFor(null); load(); }}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

// ── Historial & Logs (Release ↔ Rollback) ──
function TimelinePanel({ data }: { data: DashboardData }) {
  useLocale();
  const [open, setOpen] = useState<number | null>(null);
  if (data.timeline.length === 0 && data.rollbacks.length === 0) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title={i18nT("Historial (Release ↔ Rollback) · {length}", { length: data.timeline.length })}>
        <div className="max-h-72 space-y-1 overflow-auto">
          {data.timeline.map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-[12px]">
              <span>{e.type === "rollback" ? (e.result === "ok" ? "⏪" : "⛔") : "📦"}</span>
              <span className={cn("font-display uppercase text-[10px] px-1.5 py-0.5 rounded", e.type === "rollback" ? "bg-amber-400/15 text-amber-200" : "bg-white/5 text-white/50")}>{i18nTd(e.channel)}</span>
              <span className="truncate text-white/70" title={i18nTd(e.detail)}>{i18nTd(e.detail)}</span>
              <span className="ml-auto shrink-0 text-white/30">{fmtDate(e.at)}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title={i18nT("Logs de Rollback · {length}", { length: data.rollbacks.length })}>
        {data.rollbacks.length === 0 ? <p className="text-[12px] text-white/35">{i18nT("Sin rollbacks registrados.")}</p> : (
          <div className="max-h-72 space-y-1 overflow-auto">
            {data.rollbacks.map((ev, i) => (
              <div key={i} className="rounded-lg border border-white/10 bg-base-800/50">
                <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]">
                  <span>{ev.result === "ok" ? "🟢" : "🔴"}</span>
                  <span className="text-white/75">{i18nTd(ev.from) ?? "?"} → {i18nTd(ev.to)}</span>
                  <span className="ml-auto text-white/30">{fmtMs(ev.durationMs)}</span>
                </button>
                {open === i && (
                  <div className="border-t border-white/5 px-2.5 py-2 font-mono text-[10px] text-white/55">
                    <p>{i18nT("canal:")} {i18nTd(ev.channel)} {i18nT("· provider:")} {i18nTd(ev.provider) ?? "—"}</p>
                    <p>{i18nT("usuario:")} {i18nTd(ev.user) ?? "—"} {i18nT("· motivo:")} {i18nTd(ev.reason) ?? "—"}</p>
                    <p>{i18nT("resultado:")} {ev.result}{ev.reverted ? (" " + i18nT("(revertido)")) : ""} {i18nT("· código:")} {ev.code ?? "—"}</p>
                    <p>{i18nT("archivos:")} {ev.files} {i18nT("· firma:")} {ev.signed ? i18nT("sí") : i18nT("no")}</p>
                    {ev.verify && <p>{i18nT("verify:")} {ev.verify.ok ? "✓" : "✗"} {i18nT("({comprobados} comprobados, {difieren} difieren, {faltan} faltan)", { comprobados: ev.verify.checked, difieren: ev.verify.mismatches.length, faltan: ev.verify.missing.length })}</p>}
                    {ev.error && <p className="text-rose-300">{i18nT("error:")} {i18nTd(ev.error)}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ── Estadísticas (zona superior) ──
function StatsStrip({ data }: { data: DashboardData }) {
  useLocale();
  const s = data.stats;
  const items: [string, string, string?][] = [
    [i18nT("Releases"), String(s.releases)],
    [i18nT("Builds"), String(s.builds)],
    [i18nT("Publicadas"), String(s.published), "#37e6a0"],
    [i18nT("Rollback"), String(s.rollbackReady), "#19e3ff"],
    [i18nT("Errores"), String(s.errors), s.errors ? "#ff4d6a" : undefined],
    [i18nT("Tiempo medio"), fmtMs(s.avgBuildMs ?? s.avgUploadMs)],
    [i18nT("Tamaño medio"), fmtBytes(s.avgBytes)],
    [i18nT("Canales"), String(s.channels)],
    [i18nT("Provider"), s.activeProvider, "#ffce4f"],
  ];
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
      {items.map(([label, value, accent]) => (
        <div key={label} className="rounded-xl border border-white/10 bg-base-800/60 p-3 text-center">
          <p className="font-display text-xl font-bold leading-tight" style={{ color: accent ?? "#e8eef5" }}>{i18nTd(value)}</p>
          <p className="mt-0.5 text-[9px] uppercase tracking-wide text-white/40">{i18nTd(label)}</p>
        </div>
      ))}
    </div>
  );
}

// ── Pipeline stepper ──
function PipelineStepper({ data }: { data: DashboardData }) {
  useLocale();
  const p = data.pipeline;
  const reached = new Set((p?.transitions ?? []).map((t) => t.state));
  const elapsed = new Map((p?.transitions ?? []).map((t) => [t.state, t.elapsedMs]));
  const failed = p?.state === "failed";
  const currentIdx = PHASE_ORDER.findIndex((ph) => ph.key === p?.state);
  return (
    <Panel title={i18nT("Estado del pipeline")} right={p ? <span className="text-[11px] text-white/40">{i18nTd(p.label)} · {fmtMs(p.durationMs)}</span> : undefined}>
      {!p ? <p className="text-[12px] text-white/35">{i18nT("Sin pipeline-state.json (ejecuta el Build Cloud).")}</p> : (
        <div className="flex flex-wrap items-center gap-1.5">
          {PHASE_ORDER.map((ph, i) => {
            const done = reached.has(ph.key);
            const isCurrent = i === currentIdx;
            return (
              <div key={ph.key} className="flex items-center gap-1.5">
                <div className={cn("rounded-lg border px-2.5 py-1.5 text-center transition",
                  isCurrent && failed ? "border-rose-500/40 bg-rose-500/15" :
                  isCurrent ? "border-drl/50 bg-drl/15" :
                  done ? "border-emerald-400/25 bg-emerald-400/10" : "border-white/10 bg-white/[0.03]")}>
                  <p className={cn("font-display text-[11px] uppercase tracking-wide",
                    isCurrent && failed ? "text-rose-300" : isCurrent ? "text-drl-cyan" : done ? "text-emerald-300" : "text-white/35")}>
                    {done ? "✓ " : ""}{i18nTd(ph.label)}
                  </p>
                  {elapsed.has(ph.key) && <p className="text-[9px] text-white/30">+{fmtMs(elapsed.get(ph.key)!)}</p>}
                </div>
                {i < PHASE_ORDER.length - 1 && <span className="text-white/20">→</span>}
              </div>
            );
          })}
          {failed && p.error && <p className="w-full text-[11px] text-rose-300">⚠ {i18nTd(p.error)}</p>}
        </div>
      )}
    </Panel>
  );
}

// ── Dashboard Health ──
function HealthGrid({ items }: { items: HealthItem[] }) {
  useLocale();
  return (
    <Panel title={i18nT("Dashboard Health")}>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((h) => (
          <div key={h.key} className="flex items-start gap-2 rounded-lg border border-white/10 bg-base-800/50 px-2.5 py-2">
            <span className="text-sm leading-none">{i18nTd(DOT[h.level])}</span>
            <div className="min-w-0">
              <p className="truncate font-display text-[11px] uppercase tracking-wide text-white/80">{i18nTd(h.label)}</p>
              <p className="truncate text-[10px] text-white/35" title={i18nTd(h.detail)}>{i18nTd(h.detail)}</p>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ── Providers ──
function ProvidersRow({ providers }: { providers: ProviderStatus[] }) {
  useLocale();
  return (
    <Panel title={i18nT("Providers (Transport Engine)")}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {providers.map((p) => (
          <div key={p.name} className={cn("rounded-xl border bg-base-800/50 p-3", p.active ? "border-drl/40" : "border-white/10")}>
            <div className="flex items-center justify-between">
              <p className="font-display text-sm font-bold uppercase tracking-wide text-white">{p.name}</p>
              <span className="text-sm">{!p.configured ? "⚪" : p.healthy ? "🟢" : "🔴"}</span>
            </div>
            <p className="mt-1 text-[11px] text-white/45">{p.configured ? (p.healthy ? i18nT("Operativo") : i18nT("Con errores")) : i18nT("No configurado")}{p.active && (" " + i18nT("· activo"))}</p>
            <dl className="mt-2 space-y-0.5 text-[10px] text-white/50">
              <Row k={i18nT("Health")} v={p.detail} />
              <Row k={i18nT("Latencia")} v={p.latencyMs == null ? "—" : `${p.latencyMs} ms`} />
              <Row k={i18nT("Última pub.")} v={p.lastPublish ? p.lastPublish.full : "—"} />
              {p.errors.length > 0 && <Row k={i18nT("Errores")} v={String(p.errors.length)} tone="error" />}
            </dl>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ── Mapa de distribución global (Fase 6) ──
const REGION_FLAG: Record<string, string> = { europe: "🇪🇺", eu: "🇪🇺", usa: "🇺🇸", us: "🇺🇸", asia: "🌏", southamerica: "🌎", oceania: "🌊", global: "🌐" };
const DIST_DOT: Record<string, string> = { ok: "🟢", "partial-ready": "🟡", partial: "🟡", failed: "🔴", ready: "🟢" };

function DistributionMap({ distribution }: { distribution: DistributionData[] }) {
  useLocale();
  if (!distribution || distribution.length === 0) return null;
  return (
    <>
      {distribution.map((d) => (
        <Panel key={d.channel} title={i18nT("Mapa de distribución · {channel} · {full}", { channel: i18nTd(d.channel), full: i18nTd(d.full) })} right={
          <span className="text-[11px] text-white/45">{i18nTd(DIST_DOT[d.status]) ?? "⚪"} {i18nTd(d.status)} · {d.analytics.succeeded}/{d.analytics.targets} {i18nT("destinos ·")} {fmtMs(d.analytics.totalMs)}</span>
        }>
          {/* Analítica resumida */}
          <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            <Metric label={i18nT("Regiones")} value={d.regions.length} />
            <Metric label={i18nT("Destinos")} value={d.analytics.targets} />
            <Metric label={i18nT("OK")} value={d.analytics.succeeded} accent="#37e6a0" />
            <Metric label={i18nT("Retries")} value={d.analytics.retries} accent={d.analytics.retries ? "#ffce4f" : undefined} />
            <Metric label={i18nT("Mirrors")} value={d.analytics.mirrorsUsed} accent="#19e3ff" />
            <Metric label={i18nT("Pendientes")} value={d.targets.filter((t) => t.pending).length} accent={d.missingRequired.length ? "#ff4d6a" : undefined} />
          </div>

          {d.missingRequired.length > 0 && (
            <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
              {fill(i18nT("⛔ Regiones requeridas pendientes: {regiones} — la release NO está Ready.", slots("regiones")), { regiones: <strong>{d.missingRequired.join(", ")}</strong> })}
            </div>
          )}

          {/* Regiones */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {d.regions.map((reg) => {
              const cdn = d.cdn.regions.find((c) => c.region === reg.region);
              const isPrimaryRegion = d.cdn.primaryRegion === reg.region;
              return (
                <div key={reg.region} className={cn("rounded-xl border bg-base-800/50 p-3", reg.status === "ok" ? "border-emerald-400/25" : reg.status === "partial" ? "border-amber-400/30" : "border-rose-500/30")}>
                  <div className="flex items-center justify-between">
                    <p className="font-display text-sm font-bold uppercase tracking-wide text-white">
                      {i18nTd(REGION_FLAG[reg.region.toLowerCase()]) ?? "📍"} {i18nTd(reg.region)}
                      {isPrimaryRegion && <span className="ml-1.5 rounded bg-drl/20 px-1.5 py-0.5 text-[9px] uppercase text-drl">{i18nT("primaria")}</span>}
                    </p>
                    <span className="text-sm">{i18nTd(DIST_DOT[reg.status]) ?? "⚪"}</span>
                  </div>
                  <dl className="mt-2 space-y-0.5 text-[10px] text-white/50">
                    <Row k={i18nT("Estado")} v={`${reg.ok}/${reg.total} (${reg.status})`} tone={reg.status === "failed" ? "error" : undefined} />
                    <Row k={i18nT("Mirror principal")} v={reg.primary ?? "—"} />
                    <Row k={i18nT("Mirrors")} v={reg.mirrors.length ? reg.mirrors.join(", ") : "—"} />
                    <Row k={i18nT("Subida")} v={fmtMs(reg.uploadMs)} />
                    <Row k={i18nT("Tamaño")} v={fmtBytes(reg.bytes)} />
                    {reg.pending.length > 0 && <Row k={i18nT("Pendiente")} v={reg.pending.join(", ")} tone="error" />}
                    <Row k={i18nT("Fallback")} v={cdn?.fallbackOrder.join(" → ") ?? "—"} />
                  </dl>
                </div>
              );
            })}
          </div>

          {/* Health por destino + CDN */}
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-base-800/40 p-3">
              <p className="mb-1.5 text-[10px] uppercase tracking-widest text-white/40">{i18nT("Health por destino")}</p>
              <div className="space-y-1">
                {d.health.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 text-[11px]">
                    <span>{h.status === "down" ? "🔴" : h.score >= 70 ? "🟢" : "🟡"}</span>
                    <span className="text-white/70">{i18nTd(h.region)}/{h.name}</span>
                    <span className="ml-auto text-white/35">{i18nT("score {score} · {latencia}ms · {velocidad}/s", { score: h.score, latencia: h.latencyMs, velocidad: fmtBytes(h.speedBps) })}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-base-800/40 p-3">
              <p className="mb-1.5 text-[10px] uppercase tracking-widest text-white/40">{i18nT("CDN · región primaria:")} {d.cdn.primaryRegion ?? "—"}</p>
              <div className="space-y-1 text-[11px]">
                {d.cdn.regions.map((c) => (
                  <div key={c.region} className="flex items-center gap-2">
                    <span className="text-white/60">{i18nTd(REGION_FLAG[c.region.toLowerCase()]) ?? "📍"} {i18nTd(c.region)}</span>
                    <span className="ml-auto truncate text-white/35" title={i18nTd(c.endpoint) ?? ""}>{c.healthy}/{c.total} {i18nT("· ppal")} {i18nTd(c.primary) ?? "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      ))}
    </>
  );
}

// ── Tabla de operaciones ──
function ReleasesTable({ releases, onSelect, onRollback }: { releases: ReleaseEntry[]; onSelect: (r: ReleaseEntry) => void; onRollback: (r: ReleaseEntry) => void }) {
  useLocale();
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full min-w-[1100px] text-sm">
        <thead className="bg-base-700/60 text-left text-[10px] uppercase tracking-widest text-white/40">
          <tr>
            {[i18nT("Versión"), i18nT("Build"), i18nT("Canal"), i18nT("Estado"), i18nT("Destino"), i18nT("Publicado"), i18nT("Tamaño"), i18nT("Tiempo"), i18nT("Firma"), i18nT("Hash"), i18nT("Rollback"), i18nT("Acciones")].map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2">{i18nTd(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {releases.length === 0 && <tr><td colSpan={12} className="px-3 py-8 text-center text-white/35">{i18nT("Sin releases para este filtro.")}</td></tr>}
          {releases.map((r) => {
            const topHash = r.files.find((f) => f.sha256)?.sha256 ?? null;
            return (
              <tr key={`${r.channel}-${r.full}`} className="cursor-pointer border-t border-white/5 hover:bg-white/5" onClick={() => onSelect(r)}>
                <td className="px-3 py-2">
                  <span className="font-display font-bold text-white">{i18nTd(r.version)}</span>
                  {r.isCurrent && <span className="ml-1.5 rounded bg-drl/20 px-1.5 py-0.5 text-[9px] uppercase text-drl">{i18nT("vigente")}</span>}
                </td>
                <td className="px-3 py-2 text-white/60">{r.build ?? "—"}</td>
                <td className="px-3 py-2"><span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase text-white/60">{i18nTd(r.channel)}</span></td>
                <td className="px-3 py-2"><span className={cn("rounded-full border px-2 py-0.5 text-[10px] uppercase", STATUS_STYLE[r.status])}>{r.status}</span></td>
                <td className="px-3 py-2 text-white/60">{i18nTd(r.provider) ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-white/55">{fmtDate(r.date)}</td>
                <td className="px-3 py-2 text-white/60">{fmtBytes(r.totalBytes)}</td>
                <td className="px-3 py-2 text-white/60">{fmtMs(r.buildMs ?? r.uploadMs)}</td>
                <td className="px-3 py-2">{r.signed ? <span className="text-emerald-300">{i18nT("✓ firmada")}</span> : <span className="text-white/30">—</span>}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-white/45" title={topHash ?? ""}>{shortHash(topHash)}</td>
                <td className="px-3 py-2">{r.rollbackAvailable ? <span className="text-amber-200">{i18nT("disponible")}</span> : <span className="text-white/30">—</span>}</td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap gap-1">
                    <MiniBtn onClick={() => onSelect(r)}>{i18nT("Ver")}</MiniBtn>
                    {r.rollbackAvailable && <MiniBtn onClick={() => onRollback(r)} tone="amber">{i18nT("Rollback")}</MiniBtn>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Detalle (drawer) ──
function DetailDrawer({ release: r, onClose, onRollback }: { release: ReleaseEntry; onClose: () => void; onRollback: (r: ReleaseEntry) => void }) {
  useLocale();
  const [copied, setCopied] = useState<string | null>(null);
  const dl = (name: string) => `/api/admin/releases?download=${encodeURIComponent(r.channel)}/${encodeURIComponent(name)}`;
  const copyUrl = (f: { name: string; url?: string | null }) => {
    const u = f.url || `${location.origin}${dl(f.name)}`;
    navigator.clipboard?.writeText(u); setCopied(f.name); setTimeout(() => setCopied(null), 1200);
  };
  return (
    <motion.div className="fixed inset-0 z-[80] flex justify-end bg-black/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-base-900 p-6"
        initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="font-display text-2xl font-bold uppercase text-white">{i18nTd(r.version)}<span className="text-white/30">+{r.build}</span></h3>
            <p className="text-[12px] text-white/45">{i18nTd(r.channel)} · <span className={cn("rounded px-1.5 py-0.5 text-[10px] uppercase", STATUS_STYLE[r.status])}>{r.status}</span></p>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
          <Info k={i18nT("Commit")} v={r.commit ?? "—"} mono />
          <Info k={i18nT("Branch")} v={r.branch ?? "—"} />
          <Info k={i18nT("Autor")} v={r.author ?? "—"} />
          <Info k={i18nT("Fecha")} v={fmtDate(r.date)} />
          <Info k={i18nT("Provider")} v={r.provider ?? "—"} />
          <Info k={i18nT("Destino")} v={r.destination ?? "—"} mono />
          <Info k={i18nT("Tiempo build")} v={fmtMs(r.buildMs)} />
          <Info k={i18nT("Tiempo subida")} v={fmtMs(r.uploadMs)} />
          <Info k={i18nT("Tamaño")} v={fmtBytes(r.totalBytes)} />
          <Info k={i18nT("Firma")} v={r.signed ? i18nT("firmada") : i18nT("no firmada")} />
          <Info k={i18nT("Manifiestos")} v={`latest ${r.manifests.hasLatest ? "✓" : "—"} · meta ${r.manifests.hasMeta ? "✓" : "—"} · files ${r.manifests.hasFiles ? "✓" : "—"}`} />
          <Info k={i18nT("Rollback")} v={r.rollbackAvailable ? `disponible (${r.rollbackTargets.join(", ") || "anillo"})` : "—"} />
        </div>

        {r.notes && (
          <Section title={i18nT("Notas")}>
            <pre className="whitespace-pre-wrap rounded-lg border border-white/10 bg-base-800/60 p-3 text-[11px] text-white/60">{i18nTd(r.notes)}</pre>
          </Section>
        )}

        <Section title={i18nT("Artefactos ({length})", { length: r.files.length })}>
          <div className="space-y-1">
            {r.files.map((f) => (
              <div key={f.name} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-base-800/50 px-3 py-1.5 text-[11px]">
                <div className="min-w-0">
                  <p className="truncate font-mono text-white/80">{f.name}</p>
                  <p className="truncate text-[10px] text-white/35">{fmtBytes(f.size)} · {shortHash(f.sha256)}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => adminDownload(dl(f.name), f.name)} className="rounded border border-white/15 px-2 py-0.5 text-white/70 hover:bg-white/10">{i18nT("Descargar")}</button>
                  <button onClick={() => copyUrl(f)} className="rounded border border-white/15 px-2 py-0.5 text-white/70 hover:bg-white/10">{copied === f.name ? "✓" : i18nT("URL")}</button>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {r.verify && (
          <Section title={i18nT("Verificación")}>
            <p className="text-[11px] text-white/55">{r.verify.ok ? i18nT("✓ Byte-idéntico") : i18nT("✗ Discrepancias")} · {i18nT("{comprobados} comprobados · {difieren} difieren · {faltan} faltan", { comprobados: r.verify.checked, difieren: r.verify.mismatches.length, faltan: r.verify.missing.length })}</p>
          </Section>
        )}

        {r.pipeline && (
          <Section title={i18nT("Pipeline (log)")}>
            <div className="space-y-0.5 font-mono text-[10px] text-white/55">
              {r.pipeline.transitions.map((t, i) => <p key={i}>{i18nTd(t.state)} <span className="text-white/25">+{fmtMs(t.elapsedMs)}</span></p>)}
              {r.pipeline.error && <p className="text-rose-300">{i18nT("error:")} {i18nTd(r.pipeline.error)}</p>}
            </div>
          </Section>
        )}

        {r.reportMd && (
          <Section title={i18nT("Release Report")}>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-base-800/60 p-3 text-[10px] text-white/55">{i18nTd(r.reportMd)}</pre>
          </Section>
        )}

        <div className="mt-5 flex gap-2">
          {r.rollbackAvailable && (
            <button onClick={() => onRollback(r)} className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 font-display text-xs uppercase tracking-wide text-amber-200 hover:bg-amber-400/20">
              {i18nT("Preparar Rollback")}
            </button>
          )}
          <button type="button" onClick={() => adminDownload(dl("release-report.json"), "release-report.json")} className="rounded-xl border border-white/15 px-4 py-2 font-display text-xs uppercase tracking-wide text-white/70 hover:bg-white/10">{i18nT("Descargar report")}</button>
        </div>
      </motion.aside>
    </motion.div>
  );
}

// ── Rollback REAL (Fase 5): plan → comparación → confirmación → ejecución en vivo ──
interface PlanSummary { full: string; version: string; build: number | null; date: string | null; signed: boolean; channel: string; files: { name: string; sha256: string; size: number }[]; totalBytes: number; destination: string }
interface RollbackPlan { channel: string; valid: boolean; code: string; reason: string | null; current: PlanSummary | null; target: PlanSummary | null; diff: { changed: string[]; added: string[]; removed: string[]; affected: string[] }; availableTargets: PlanSummary[] }
interface RollbackResult { ok: boolean; ready: boolean; error: string | null; code: string; full: string; version: string; build: number | null; durationMs: number; reverted?: boolean; rolledBackFrom: string | null; verify: { ok: boolean; checked: number; mismatches: string[]; missing: string[] } | null; phases: { phase: string; label: string; elapsedMs: number }[] }

const RB_PHASES = ["Rolling back", "Verifying", "Publishing", "Ready"];

function RollbackModal({ target, current, allReleases, onClose, onDone }: { target: ReleaseEntry; current: ReleaseEntry | null; allReleases: ReleaseEntry[]; onClose: () => void; onDone: () => void }) {
  useLocale();
  const channel = target.channel;
  const [selectedFull, setSelectedFull] = useState(target.full);
  const [step, setStep] = useState<"loading" | "plan" | "confirm" | "running" | "done" | "error">("loading");
  const [plan, setPlan] = useState<RollbackPlan | null>(null);
  const [result, setResult] = useState<RollbackResult | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState(0);

  const targetsInChannel = useMemo(() => allReleases.filter((x) => x.channel === channel && !x.isCurrent), [allReleases, channel]);

  const loadPlan = useCallback(async (toFull: string) => {
    setStep("loading"); setErr(null);
    try {
      const res = await adminFetch("/api/admin/releases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "plan", channel, toFull }) });
      const p = await res.json();
      if (!res.ok) throw new Error(p.error ?? "plan falló");
      setPlan(p); setStep("plan");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setStep("error"); }
  }, [channel]);
  useEffect(() => { loadPlan(selectedFull); }, [selectedFull, loadPlan]);

  const execute = async () => {
    setStep("running"); setActivePhase(0);
    const timer = setInterval(() => setActivePhase((i) => Math.min(i + 1, RB_PHASES.length - 2)), 450);
    try {
      const res = await adminFetch("/api/admin/releases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rollback", channel, toFull: selectedFull, reason }) });
      const r: RollbackResult & { error?: string } = await res.json();
      clearInterval(timer);
      setResult(r);
      if (r.ok) { setActivePhase(RB_PHASES.length - 1); setStep("done"); setTimeout(onDone, 1600); }
      else { setErr(r.error ?? r.code ?? i18nT("rollback fallido")); setStep("error"); }
    } catch (e) { clearInterval(timer); setErr(e instanceof Error ? e.message : String(e)); setStep("error"); }
  };

  const valid = plan?.valid ?? false;
  return (
    <motion.div className="fixed inset-0 z-[85] grid place-items-center bg-black/80 p-4 backdrop-blur" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={step === "running" ? undefined : onClose}>
      <motion.div className="w-full max-w-xl rounded-2xl border border-amber-400/30 bg-base-900 p-6" initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94 }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-xl font-bold uppercase text-amber-200">{i18nT("Rollback ·")} {i18nTd(channel)}</h3>
          {step !== "running" && <button onClick={onClose} className="text-white/50 hover:text-white">✕</button>}
        </div>

        {step === "loading" && <p className="py-8 text-center text-white/50">{i18nT("Leyendo history.json…")}</p>}

        {(step === "plan" || step === "confirm") && plan && (
          <>
            {/* Paso 1/2: versiones disponibles del anillo */}
            <label className="mb-3 block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-white/40">{i18nT("Versión destino (anillo)")}</span>
              <select value={selectedFull} onChange={(e) => setSelectedFull(e.target.value)} className={cn(selectCls, "w-full")}>
                {targetsInChannel.length === 0 && <option value={selectedFull}>{i18nTd(selectedFull)}</option>}
                {targetsInChannel.map((t) => <option key={t.full} value={t.full}>{i18nTd(t.full)} · {fmtDate(t.date)}{t.signed ? (" " + i18nT("· firmada")) : ""}</option>)}
              </select>
            </label>

            {/* Paso 3: comparación */}
            <div className="space-y-2 text-[13px]">
              <FlowStep label={i18nT("Release actual")} value={current ? `${current.version}+${current.build}` : (plan.current?.full ?? "—")} sub={i18nTd(channel)} tone="current" />
              <div className="pl-4 text-white/30">{i18nT("↓ rollback")}</div>
              <FlowStep label={i18nT("Volver a")} value={plan.target?.full ?? selectedFull} sub={plan.target ? fmtDate(plan.target.date) : undefined} tone="target" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <Mini k={i18nT("Firma destino")} v={plan.target?.signed ? "✓ firmada" : i18nT("✗ sin firma")} tone={plan.target?.signed ? "ok" : "error"} />
              <Mini k={i18nT("Tamaño")} v={fmtBytes(plan.target?.totalBytes)} />
              <Mini k={i18nT("Archivos afectados")} v={String(plan.diff.affected.length)} />
              <Mini k={i18nT("Hashes")} v={i18nT("{v} con SHA256", { v: plan.target?.files.length ?? 0 })} />
            </div>
            <div className="mt-2 rounded-lg border border-white/10 bg-base-800/60 p-2.5">
              <p className="mb-1 text-[10px] uppercase tracking-widest text-white/40">{i18nT("Cambios ({n})", { n: plan.diff.affected.length })}</p>
              <div className="max-h-28 space-y-0.5 overflow-auto font-mono text-[10px] text-white/55">
                {plan.diff.affected.length === 0 && <p className="text-white/30">{i18nT("— (idénticos)")}</p>}
                {plan.diff.changed.map((f) => <p key={f}><span className="text-amber-300">~</span> {i18nTd(f)}</p>)}
                {plan.diff.added.map((f) => <p key={f}><span className="text-emerald-300">+</span> {i18nTd(f)}</p>)}
                {plan.diff.removed.map((f) => <p key={f}><span className="text-rose-300">−</span> {i18nTd(f)}</p>)}
              </div>
            </div>

            {!valid && <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[12px] text-rose-200">⛔ {i18nTd(plan.reason)} <span className="text-rose-300/60">({plan.code})</span></div>}

            {step === "plan" && valid && (
              <>
                <label className="mt-3 block">
                  <span className="mb-1 block text-[10px] uppercase tracking-widest text-white/40">{i18nT("Motivo (opcional, queda en el log)")}</span>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={i18nT("p.ej. regresión crítica en 1.0.3")} className="w-full rounded-lg border border-white/10 bg-base-800 px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-drl focus:outline-none" />
                </label>
                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={onClose} className="rounded-xl border border-white/15 px-4 py-2 font-display text-xs uppercase tracking-wide text-white/70 hover:bg-white/10">{i18nT("Cancelar")}</button>
                  <button onClick={() => setStep("confirm")} className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 font-display text-xs uppercase tracking-wide text-amber-200 hover:bg-amber-400/20">{i18nT("Continuar")}</button>
                </div>
              </>
            )}

            {/* Paso 4: confirmación */}
            {step === "confirm" && (
              <div className="mt-4">
                <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-[13px] text-amber-100">
                  <p className="font-display font-bold text-amber-200">{i18nT("¿Seguro que deseas volver a la versión {version}?", { version: i18nTd(selectedFull) ?? "" })}</p>
                  <p className="mt-1 text-amber-100/75">
                    {fill(i18nT("Se restaurará desde el anillo, se verificará byte a byte (SHA256 + firma) y se republicará en el canal {canal} con el provider activo. Los launchers que abran el juego verán {version} como versión publicada (aunque sea anterior).", slots("canal", "version")), { canal: <strong>{i18nTd(channel)}</strong>, version: <strong>{i18nTd(selectedFull)}</strong> })}
                  </p>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={() => setStep("plan")} className="rounded-xl border border-white/15 px-4 py-2 font-display text-xs uppercase tracking-wide text-white/70 hover:bg-white/10">{i18nT("Atrás")}</button>
                  <button onClick={execute} className="rounded-xl border border-amber-400/50 bg-amber-400/20 px-4 py-2 font-display text-xs uppercase tracking-wide text-amber-100 hover:bg-amber-400/30">{i18nT("Sí, hacer rollback")}</button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Paso 8: progreso en vivo */}
        {step === "running" && (
          <div className="py-4">
            <div className="flex items-center justify-between gap-1.5">
              {RB_PHASES.map((label, i) => (
                <div key={label} className="flex flex-1 items-center gap-1.5">
                  <div className={cn("flex-1 rounded-lg border px-2 py-2 text-center transition", i < activePhase ? "border-emerald-400/30 bg-emerald-400/10" : i === activePhase ? "border-amber-400/50 bg-amber-400/15" : "border-white/10 bg-white/[0.03]")}>
                    <p className={cn("font-display text-[10px] uppercase tracking-wide", i < activePhase ? "text-emerald-300" : i === activePhase ? "text-amber-200" : "text-white/35")}>{i < activePhase ? "✓ " : ""}{i18nTd(label)}</p>
                  </div>
                  {i < RB_PHASES.length - 1 && <span className="text-white/20">→</span>}
                </div>
              ))}
            </div>
            <p className="mt-4 text-center text-[12px] text-white/45">{i18nT("Ejecutando rollback real (TransportEngine.rollback)…")}</p>
          </div>
        )}

        {step === "done" && result && (
          <div className="py-4 text-center">
            <p className="font-display text-2xl text-emerald-300">{i18nT("✓ Rollback completado")}</p>
            <p className="mt-1 text-[13px] text-white/60">{fill(i18nT("Ahora publicada: {version} en {canal}", { ...slots("version"), canal: i18nTd(channel) ?? "" }), { version: <strong className="text-white">{i18nTd(result.full)}</strong> })}</p>
            <p className="mt-1 text-[11px] text-white/40">{i18nT("Verificación {estado} · {duracion} · desde {origen}", { estado: result.verify?.ok ? i18nT("✓ byte-idéntica") : "—", duracion: fmtMs(result.durationMs), origen: i18nTd(result.rolledBackFrom) ?? "—" })}</p>
            <p className="mt-3 text-[11px] text-drl-cyan">{i18nT("Actualizando dashboard…")}</p>
          </div>
        )}

        {step === "error" && (
          <div className="py-6 text-center">
            <p className="font-display text-xl text-rose-300">{i18nT("⛔ Rollback cancelado")}</p>
            <p className="mt-2 text-[13px] text-rose-200/80">{i18nTd(err)}</p>
            {result?.reverted && <p className="mt-1 text-[11px] text-amber-200/70">{i18nT("Se revirtió a la versión previa (sin cambios efectivos).")}</p>}
            <button onClick={onClose} className="mt-4 rounded-xl border border-white/15 px-4 py-2 font-display text-xs uppercase tracking-wide text-white/70 hover:bg-white/10">{i18nT("Cerrar")}</button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function Mini({ k, v, tone }: { k: string; v: string; tone?: "ok" | "error" }) {
  return <div className="rounded-lg border border-white/10 bg-base-800/50 px-2.5 py-1.5"><p className="text-[9px] uppercase tracking-widest text-white/35">{i18nTd(k)}</p><p className={cn("font-display text-white/80", tone === "ok" && "text-emerald-300", tone === "error" && "text-rose-300")}>{i18nTd(v)}</p></div>;
}

// ── primitivas UI ──
const selectCls = "rounded-lg border border-white/10 bg-base-800 px-2.5 py-1.5 text-xs text-white focus:border-drl focus:outline-none";

function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  useLocale();
  return (
    <div className="rounded-2xl border border-white/10 bg-base-700/40 p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-white/40">{i18nTd(title)}</p>
        {right}
      </div>
      {children}
    </div>
  );
}
function Metric({ label, value, accent }: { label: string; value: number; accent?: string }) {
  useLocale();
  return (
    <div className="rounded-xl border border-white/10 bg-base-900/40 p-2 text-center">
      <p className="font-display text-lg font-bold leading-tight" style={{ color: accent ?? "#e8eef5" }}>{value}</p>
      <p className="text-[9px] uppercase tracking-wide text-white/40">{i18nTd(label)}</p>
    </div>
  );
}
function Banner({ tone, children }: { tone: "error" | "warn"; children: React.ReactNode }) {
  return <div className={cn("rounded-xl border px-4 py-3 text-sm", tone === "error" ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : "border-amber-400/30 bg-amber-400/10 text-amber-100")}>{children}</div>;
}
function Row({ k, v, tone }: { k: string; v: string; tone?: "error" }) {
  return <div className="flex justify-between gap-2"><dt className="text-white/35">{i18nTd(k)}</dt><dd className={cn("truncate text-right", tone === "error" ? "text-rose-300" : "text-white/60")} title={i18nTd(v)}>{i18nTd(v)}</dd></div>;
}
function Info({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="border-b border-white/5 py-1"><p className="text-[10px] uppercase tracking-widest text-white/35">{i18nTd(k)}</p><p className={cn("truncate text-white/75", mono && "font-mono text-[11px]")} title={i18nTd(v)}>{i18nTd(v)}</p></div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  useLocale();
  return <div className="mt-4"><p className="mb-1.5 text-[10px] uppercase tracking-widest text-white/40">{i18nTd(title)}</p>{children}</div>;
}
function MiniBtn({ children, onClick, tone }: { children: React.ReactNode; onClick: () => void; tone?: "amber" }) {
  return <button onClick={onClick} className={cn("rounded-md border px-2 py-1 font-display text-[10px] uppercase tracking-wide transition", tone === "amber" ? "border-amber-400/40 text-amber-200 hover:bg-amber-400/10" : "border-white/15 text-white/70 hover:bg-white/10 hover:text-white")}>{children}</button>;
}
function FlowStep({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "current" | "target" }) {
  useLocale();
  return (
    <div className={cn("rounded-lg border px-3 py-2", tone === "current" ? "border-drl/30 bg-drl/10" : "border-emerald-400/25 bg-emerald-400/5")}>
      <p className="text-[10px] uppercase tracking-widest text-white/40">{i18nTd(label)}</p>
      <p className="font-display font-bold text-white">{i18nTd(value)}{sub && <span className="ml-2 text-[11px] font-normal text-white/40">{i18nTd(sub)}</span>}</p>
    </div>
  );
}
