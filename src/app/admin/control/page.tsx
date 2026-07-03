"use client";

/**
 * RELEASE CONTROL CENTER (/admin/control) — NOC de operaciones de DRL Champions (Fase 7/7).
 * SOLO ORQUESTA: consume el mismo `/api/admin/releases` (Fases 4-6), deriva las 12 secciones con
 * `buildControlCenter` (puro) y dispara los motores existentes (rollback/promote/retry/download).
 * No crea pipeline/transport/updater/rollback/distribution nuevos. Polling vivo, sin recargar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ADMIN_ENABLED } from "@/config/admin";
import { cn } from "@/lib/format";
import type { DashboardData } from "@/server/releases/types";
import { buildControlCenter, type ControlCenterData, type LogCategory, type CcAlert } from "@/server/releases/control";

// ── formato ──
const fmtBytes = (n?: number | null) => n == null ? "—" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
const fmtMs = (n?: number | null) => n == null ? "—" : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`;
const fmtDate = (s?: string | null) => { if (!s) return "—"; try { return new Date(s).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "medium" }); } catch { return s; } };
const short = (h?: string | null) => h ? `${h.slice(0, 12)}…` : "—";
const REGION_FLAG: Record<string, string> = { europe: "🇪🇺", usa: "🇺🇸", asia: "🌏", southamerica: "🌎", oceania: "🌊", global: "🌐" };
const NOC = { operational: { dot: "🟢", label: "OPERATIONAL", cls: "text-emerald-300" }, degraded: { dot: "🟡", label: "DEGRADED", cls: "text-amber-300" }, down: { dot: "🔴", label: "DOWN", cls: "text-rose-300" } };
const PHASES = [["queued", "Queued"], ["running", "Running"], ["building", "Building"], ["signing", "Signing"], ["manifests", "Manifests"], ["uploading", "Publishing"], ["verifying", "Verifying"], ["published", "Distributing"], ["ready", "Ready"]];

export default function ControlCenterPage() {
  if (!ADMIN_ENABLED) {
    return <div className="grid min-h-[60vh] place-items-center text-center"><div><p className="font-display text-2xl font-bold uppercase text-white">Acceso restringido</p><p className="mt-2 text-white/50">Requiere <code className="text-drl">NEXT_PUBLIC_ADMIN=1</code>.</p></div></div>;
  }
  return <ControlCenter />;
}

function ControlCenter() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);
  const liveRef = useRef(live); liveRef.current = live;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/releases", { cache: "no-store" });
      if (!res.ok) throw new Error(`API ${res.status}`);
      setData(await res.json()); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  // Polling vivo (solo refresca DATOS, no la página); pausa si la pestaña no es visible.
  useEffect(() => {
    load();
    const id = setInterval(() => { if (liveRef.current && !document.hidden) load(); }, 5000);
    return () => clearInterval(id);
  }, [load]);

  // Acción genérica → motor existente (POST), con confirmación y refresco.
  const act = useCallback(async (label: string, body: Record<string, unknown>, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(label);
    try {
      const res = await fetch("/api/admin/releases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const r = await res.json();
      const ok = res.ok && (r.ok ?? r.ready ?? true);
      setFlash({ ok, msg: ok ? `${label}: OK` : `${label}: ${r.error ?? r.code ?? "falló"}` });
      await load();
    } catch (e) { setFlash({ ok: false, msg: `${label}: ${e instanceof Error ? e.message : String(e)}` }); }
    finally { setBusy(null); setTimeout(() => setFlash(null), 4000); }
  }, [load]);

  const cc = useMemo<ControlCenterData | null>(() => (data ? buildControlCenter(data) : null), [data]);

  if (error && !data) return <div className="m-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-200">No se pudo cargar el Control Center: {error}. ¿Ejecutaste <code>npm run ci:pipeline</code>?</div>;
  if (!cc) return <div className="grid min-h-[50vh] place-items-center text-white/50">Cargando Control Center…</div>;

  const noc = NOC[cc.status];
  return (
    <div className="animate-rise space-y-4 pb-10">
      {/* ── Barra de estado NOC ── */}
      <header className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-base-900/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="text-lg">{noc.dot}</span>
          <div>
            <h1 className="font-display text-xl font-bold uppercase tracking-wide text-white">Release <span className="text-drl">Control Center</span></h1>
            <p className="text-[11px] text-white/45">NOC · <span className={cn("font-display", noc.cls)}>{noc.label}</span> · {fmtDate(cc.generatedAt)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {flash && <span className={cn("rounded-lg px-3 py-1 text-[11px]", flash.ok ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-500/15 text-rose-300")}>{flash.msg}</span>}
          <button onClick={() => setLive((v) => !v)} className={cn("rounded-lg border px-3 py-1.5 font-display text-[11px] uppercase tracking-wide transition", live ? "border-emerald-400/40 text-emerald-300" : "border-white/15 text-white/50")}>{live ? "● Live" : "⏸ Pausado"}</button>
          <button onClick={load} className="rounded-lg border border-white/15 px-3 py-1.5 font-display text-[11px] uppercase tracking-wide text-white/70 hover:bg-white/10">↻</button>
        </div>
      </header>

      {/* ── 11. Alerts ── */}
      <AlertsBar alerts={cc.alerts} />

      {/* ── 12. Quick Actions ── */}
      <QuickActions cc={cc} busy={busy} act={act} />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 1. Release Live */}
        <Panel title="Release Live" className="lg:col-span-2">
          <ReleaseLive cc={cc} />
        </Panel>
        {/* 9. Analytics */}
        <Panel title="Analytics">
          <Analytics cc={cc} />
        </Panel>
      </div>

      {/* 2. Pipeline Live */}
      <Panel title="Pipeline Live"><PipelineLive cc={cc} /></Panel>

      {/* 3. Global Map */}
      <Panel title="Global Map"><GlobalMap cc={cc} /></Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 4. Providers */}
        <Panel title="Providers"><Providers cc={cc} /></Panel>
        {/* 6. Channel Manager */}
        <Panel title="Channel Manager"><Channels cc={cc} busy={busy} act={act} /></Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 7. Rollback Center */}
        <Panel title="Rollback Center"><RollbackCenter cc={cc} busy={busy} act={act} /></Panel>
        {/* 8. Build Monitor */}
        <Panel title="Build Monitor"><BuildMonitor cc={cc} /></Panel>
      </div>

      {/* 5. Release History */}
      <Panel title="Release History"><History cc={cc} busy={busy} act={act} /></Panel>

      {/* 10. Logs */}
      <Panel title="Logs"><Logs cc={cc} /></Panel>
    </div>
  );
}

// ── 11. Alerts ──
function AlertsBar({ alerts }: { alerts: CcAlert[] }) {
  if (alerts.length === 0) return <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-2 text-[12px] text-emerald-300">✓ Sin alertas · todos los sistemas operativos.</div>;
  const dot = { critical: "🔴", warning: "🟡", info: "🔵" };
  return (
    <div className="space-y-1.5">
      {alerts.map((a) => (
        <div key={a.key} className={cn("flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px]", a.level === "critical" ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : a.level === "warning" ? "border-amber-400/30 bg-amber-400/10 text-amber-100" : "border-sky-400/25 bg-sky-400/5 text-sky-200")}>
          <span>{dot[a.level]}</span><strong className="font-display uppercase">{a.title}</strong><span className="text-white/60">{a.detail}</span><span className="ml-auto text-white/30">{fmtDate(a.at)}</span>
        </div>
      ))}
    </div>
  );
}

// ── 12. Quick Actions ──
function QuickActions({ cc, busy, act }: { cc: ControlCenterData; busy: string | null; act: ActFn }) {
  const q = cc.quickActions;
  const dl = (name: string) => `/api/admin/releases?download=${encodeURIComponent(cc.releaseLive?.channel ?? "stable")}/${encodeURIComponent(name)}`;
  const installer = cc.releaseLive?.files.find((f) => /\.(exe|msi)$/i.test(f.name));
  return (
    <div className="flex flex-wrap gap-2">
      <QBtn disabled={!q.canRollback || !!busy} tone="amber" onClick={() => q.rollbackChannel && q.rollbackTarget && act("Rollback", { action: "rollback", channel: q.rollbackChannel, toFull: q.rollbackTarget }, `¿Ejecutar rollback de ${q.rollbackChannel} a ${q.rollbackTarget}?`)}>Rollback</QBtn>
      <QBtn disabled={!q.canPromote || !!busy} tone="cyan" onClick={() => act("Promover", { action: "promote", channel: q.promoteFrom, toChannel: q.promoteTo }, `¿Promover ${q.promoteFrom} → ${q.promoteTo}? (republica los mismos artefactos, sin nueva versión)`)}>Promover {q.promoteFrom ?? "Beta"}→{q.promoteTo ?? "Stable"}</QBtn>
      <QBtn disabled={!q.canRetry || !!busy} onClick={() => cc.globalMap[0] && act("Reintentar", { action: "retry", channel: cc.globalMap.find((d) => d.status !== "ready")?.channel ?? cc.globalMap[0].channel })}>Reintentar</QBtn>
      <a href={installer ? dl(installer.name) : dl("files.json")} className="rounded-lg border border-white/15 px-3 py-1.5 font-display text-[11px] uppercase tracking-wide text-white/70 hover:bg-white/10">Descargar instalador</a>
      {installer && <QBtn onClick={() => { navigator.clipboard?.writeText(installer.url || `${location.origin}${dl(installer.name)}`); }}>Copiar URL</QBtn>}
      <QBtn disabled onClick={() => {}} title="Build/publish completo = CI/CLI (npm run ci:pipeline)">Crear Release (CI)</QBtn>
    </div>
  );
}

// ── 1. Release Live ──
function ReleaseLive({ cc }: { cc: ControlCenterData }) {
  const r = cc.releaseLive;
  if (!r) return <p className="text-[12px] text-white/40">Sin release vigente.</p>;
  const regions = cc.globalMap.find((d) => d.channel === r.channel)?.regions.map((x) => x.region) ?? [];
  const topHash = r.files.find((f) => f.sha256)?.sha256 ?? null;
  const items: [string, string][] = [
    ["Versión", r.version], ["Build", String(r.build ?? "—")], ["Canal", r.channel], ["Estado", r.status],
    ["Commit", r.commit ?? "—"], ["Branch", r.branch ?? "—"], ["Autor", r.author ?? "—"], ["Fecha", fmtDate(r.date)],
    ["Tiempo build", fmtMs(r.buildMs)], ["Firma", r.signed ? "✓ firmada" : "—"], ["Provider", r.provider ?? "—"], ["Regiones", regions.length ? regions.join(", ") : "global"],
  ];
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
      {items.map(([k, v]) => <div key={k} className="border-b border-white/5 py-1"><p className="text-[9px] uppercase tracking-widest text-white/35">{k}</p><p className="truncate font-display text-white/85" title={v}>{v}</p></div>)}
      <div className="col-span-2 border-b border-white/5 py-1 sm:col-span-3"><p className="text-[9px] uppercase tracking-widest text-white/35">Hash</p><p className="truncate font-mono text-[11px] text-white/60">{short(topHash)}{r.kind === "rollback" && <span className="ml-2 rounded bg-amber-400/15 px-1.5 text-[9px] uppercase text-amber-200">rollback de {r.rolledBackFrom}</span>}</p></div>
    </div>
  );
}

// ── 2. Pipeline Live ──
function PipelineLive({ cc }: { cc: ControlCenterData }) {
  const p = cc.pipeline;
  if (!p) return <p className="text-[12px] text-white/35">Sin pipeline-state.json.</p>;
  const reached = new Set(p.transitions.map((t) => t.state));
  const failed = p.state === "failed";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PHASES.map(([key, label], i) => {
        const done = reached.has(key); const isCur = p.state === key;
        return (
          <div key={key} className="flex items-center gap-1.5">
            <div className={cn("rounded-lg border px-2.5 py-1.5 transition", isCur && failed ? "border-rose-500/40 bg-rose-500/15 animate-pulse" : isCur ? "border-drl/50 bg-drl/15 animate-pulse" : done ? "border-emerald-400/25 bg-emerald-400/10" : "border-white/10 bg-white/[0.03]")}>
              <p className={cn("font-display text-[10px] uppercase tracking-wide", isCur ? "text-drl-cyan" : done ? "text-emerald-300" : "text-white/35")}>{done ? "✓ " : ""}{label}</p>
            </div>
            {i < PHASES.length - 1 && <span className="text-white/20">→</span>}
          </div>
        );
      })}
      <span className="ml-2 text-[11px] text-white/40">{p.label} · {fmtMs(p.durationMs)}</span>
    </div>
  );
}

// ── 3. Global Map ──
function GlobalMap({ cc }: { cc: ControlCenterData }) {
  const dist = cc.globalMap;
  if (dist.length === 0) return <p className="text-[12px] text-white/35">Sin distribución multi-región (provider único). Configura <code>DRL_DISTRIBUTION</code> para activar regiones.</p>;
  const dot: Record<string, string> = { ok: "🟢", partial: "🟡", failed: "🔴" };
  return (
    <div className="space-y-3">
      {dist.map((d) => (
        <div key={d.channel}>
          <p className="mb-1.5 text-[11px] uppercase tracking-widest text-white/40">{d.channel} · {d.full} · primaria {d.cdn.primaryRegion ?? "—"}</p>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {d.regions.map((reg) => {
              const h = d.health.find((x) => x.region === reg.region);
              return (
                <div key={reg.region} className={cn("rounded-xl border bg-base-800/50 p-2.5", reg.status === "ok" ? "border-emerald-400/25" : reg.status === "partial" ? "border-amber-400/30" : "border-rose-500/30")}>
                  <p className="font-display text-[12px] font-bold uppercase text-white">{REGION_FLAG[reg.region.toLowerCase()] ?? "📍"} {reg.region} {dot[reg.status]}</p>
                  <p className="mt-1 text-[10px] text-white/45">{reg.providers.join(", ")}</p>
                  <p className="text-[10px] text-white/35">latencia {h?.latencyMs ?? "—"}ms · score {h?.score ?? "—"}</p>
                  <p className="text-[10px] text-white/35">subida {fmtMs(reg.uploadMs)} · mirror {reg.primary ?? "—"}</p>
                  {reg.pending.length > 0 && <p className="text-[10px] text-rose-300">pendiente: {reg.pending.join(",")}</p>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 4. Providers ──
function Providers({ cc }: { cc: ControlCenterData }) {
  const dHealth = cc.globalMap.flatMap((d) => d.health);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[11px]">
        <thead className="text-left text-[9px] uppercase tracking-widest text-white/40"><tr>{["Provider", "Estado", "Score", "Latencia", "Velocidad", "Errores", "Último uso"].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr></thead>
        <tbody>
          {cc.providers.map((p) => {
            const h = dHealth.find((x) => x.name === p.name);
            return (
              <tr key={p.name} className="border-t border-white/5">
                <td className="px-2 py-1.5 font-display uppercase text-white/80">{p.name}{p.active && <span className="ml-1 text-[9px] text-drl">●</span>}</td>
                <td className="px-2 py-1.5">{!p.configured ? "⚪ n/c" : p.healthy ? "🟢 ok" : "🔴 caído"}</td>
                <td className="px-2 py-1.5 text-white/60">{h?.score ?? (p.healthy ? "—" : 0)}</td>
                <td className="px-2 py-1.5 text-white/60">{p.latencyMs == null ? "—" : `${p.latencyMs}ms`}</td>
                <td className="px-2 py-1.5 text-white/60">{h ? `${fmtBytes(h.speedBps)}/s` : "—"}</td>
                <td className="px-2 py-1.5 text-white/60">{p.errors.length}</td>
                <td className="px-2 py-1.5 text-white/45">{p.lastPublish?.full ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── 6. Channel Manager ──
function Channels({ cc, busy, act }: { cc: ControlCenterData; busy: string | null; act: ActFn }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cc.channels.map((c) => (
          <div key={c.channel} className="rounded-lg border border-white/10 bg-base-800/50 p-2.5">
            <p className="font-display text-[12px] font-bold uppercase text-white">{c.channel}</p>
            <p className="text-[11px] text-white/60">{c.full ?? "—"}</p>
            <p className="text-[10px] text-white/35">{c.status} · {c.signed ? "firmada" : "sin firma"}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-white/10 bg-base-800/40 p-2.5">
        <p className="mb-1 text-[9px] uppercase tracking-widest text-white/40">Comparativa de canales</p>
        {cc.channelDiffs.filter((d) => d.fromFull || d.toFull).map((d) => (
          <p key={`${d.from}-${d.to}`} className="text-[11px] text-white/55">{d.from} ({d.fromFull ?? "—"}) vs {d.to} ({d.toFull ?? "—"}) · {d.same ? "✓ iguales" : "≠ distintas"}</p>
        ))}
      </div>
      <button disabled={!cc.quickActions.canPromote || !!busy} onClick={() => act("Promover", { action: "promote", channel: cc.quickActions.promoteFrom, toChannel: cc.quickActions.promoteTo }, `¿Promover ${cc.quickActions.promoteFrom} → ${cc.quickActions.promoteTo}?`)}
        className="w-full rounded-lg border border-drl-cyan/40 bg-drl-cyan/10 px-3 py-2 font-display text-[11px] uppercase tracking-wide text-drl-cyan transition hover:bg-drl-cyan/20 disabled:opacity-40">
        Promover {cc.quickActions.promoteFrom ?? "beta"} → {cc.quickActions.promoteTo ?? "stable"} (reutiliza distributeRelease)
      </button>
    </div>
  );
}

// ── 7. Rollback Center ──
function RollbackCenter({ cc, busy, act }: { cc: ControlCenterData; busy: string | null; act: ActFn }) {
  return (
    <div className="space-y-2">
      <p className="text-[9px] uppercase tracking-widest text-white/40">Candidatos (anillo)</p>
      <div className="space-y-1">
        {cc.rollbackCenter.candidates.length === 0 && <p className="text-[11px] text-white/35">Sin candidatos de rollback.</p>}
        {cc.rollbackCenter.candidates.slice(0, 6).map((r) => (
          <div key={`${r.channel}-${r.full}`} className="flex items-center gap-2 rounded-lg border border-white/10 bg-base-800/50 px-2.5 py-1.5 text-[11px]">
            <span className="text-white/70">{r.channel} · {r.full}</span>
            <span className="text-white/35">{r.files.length} arch · {r.signed ? "firmada" : "sin firma"}</span>
            <button disabled={!!busy} onClick={() => act("Rollback", { action: "rollback", channel: r.channel, toFull: r.full }, `¿Rollback de ${r.channel} a ${r.full}? Se verificará byte a byte y se republicará.`)}
              className="ml-auto rounded border border-amber-400/40 px-2 py-0.5 font-display text-[10px] uppercase text-amber-200 hover:bg-amber-400/10 disabled:opacity-40">Rollback</button>
          </div>
        ))}
      </div>
      <p className="pt-1 text-[9px] uppercase tracking-widest text-white/40">Historial de rollback ({cc.rollbackCenter.events.length})</p>
      <div className="max-h-40 space-y-0.5 overflow-auto font-mono text-[10px] text-white/55">
        {cc.rollbackCenter.events.map((e, i) => <p key={i}>{e.result === "ok" ? "🟢" : "🔴"} {e.from ?? "?"}→{e.to} ({e.channel}) · {fmtMs(e.durationMs)} · {e.user ?? "—"}{e.reason ? ` · ${e.reason}` : ""}</p>)}
        {cc.rollbackCenter.events.length === 0 && <p className="text-white/30">— sin rollbacks —</p>}
      </div>
    </div>
  );
}

// ── 8. Build Monitor ──
function BuildMonitor({ cc }: { cc: ControlCenterData }) {
  const b = cc.buildMonitor;
  if (!b) return <p className="text-[12px] text-white/35">Sin build vigente.</p>;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Tiempo" value={fmtMs(b.buildMs)} />
        <Metric label="Artefactos" value={String(b.artifacts.length)} />
        <Metric label="Tamaño" value={fmtBytes(b.totalBytes)} />
        <Metric label="Firma" value={b.signed ? "✓" : "—"} />
        <Metric label="CPU" value={b.cpu == null ? "n/d" : `${b.cpu}%`} />
        <Metric label="RAM" value={b.ram == null ? "n/d" : `${b.ram}%`} />
      </div>
      <div className="rounded-lg border border-white/10 bg-base-800/40 p-2.5">
        <p className="mb-1 text-[9px] uppercase tracking-widest text-white/40">Artefactos + hashes</p>
        <div className="max-h-32 space-y-0.5 overflow-auto font-mono text-[10px] text-white/55">
          {b.artifacts.map((f) => <p key={f.name}>{f.name} · {fmtBytes(f.size)} · {short(f.sha256)}</p>)}
        </div>
      </div>
      <p className="text-[9px] text-white/30">{b.note}</p>
    </div>
  );
}

// ── 9. Analytics ──
function Analytics({ cc }: { cc: ControlCenterData }) {
  const a = cc.analytics;
  const rows: [string, string][] = [
    ["Build medio", fmtMs(a.avgBuildMs)], ["Publish medio", fmtMs(a.avgPublishMs)], ["Rollback medio", fmtMs(a.avgRollbackMs)],
    ["Región más lenta", a.slowestRegion ? `${a.slowestRegion.region} (${fmtMs(a.slowestRegion.ms)})` : "—"],
    ["Provider más rápido", a.fastestProvider ? `${a.fastestProvider.name} (${a.fastestProvider.latencyMs}ms)` : "—"],
    ["Disponibilidad", `${a.availabilityPct}%`], ["Builds", String(a.builds)], ["Releases", String(a.releases)],
    ["Rollbacks", String(a.rollbacks)], ["Retries", String(a.retries)], ["Errores", String(a.errors)],
  ];
  return <div className="space-y-1">{rows.map(([k, v]) => <div key={k} className="flex justify-between text-[11px]"><span className="text-white/40">{k}</span><span className="font-display text-white/80">{v}</span></div>)}</div>;
}

// ── 5. Release History ──
function History({ cc, busy, act }: { cc: ControlCenterData; busy: string | null; act: ActFn }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-[11px]">
        <thead className="text-left text-[9px] uppercase tracking-widest text-white/40"><tr>{["Versión", "Build", "Canal", "Fecha", "Estado", "Rollback", "Commit", "Acciones"].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr></thead>
        <tbody>
          {cc.history.map((r) => {
            const inst = r.files.find((f) => /\.(exe|msi)$/i.test(f.name));
            return (
              <tr key={`${r.channel}-${r.full}`} className="border-t border-white/5">
                <td className="px-2 py-1.5 font-display text-white/85">{r.version}{r.isCurrent && <span className="ml-1 text-[9px] text-drl">vigente</span>}</td>
                <td className="px-2 py-1.5 text-white/55">{r.build ?? "—"}</td>
                <td className="px-2 py-1.5 text-white/55">{r.channel}</td>
                <td className="px-2 py-1.5 text-white/45">{fmtDate(r.date)}</td>
                <td className="px-2 py-1.5">{r.status}</td>
                <td className="px-2 py-1.5">{r.rollbackAvailable ? "disponible" : "—"}</td>
                <td className="px-2 py-1.5 font-mono text-[10px] text-white/45">{r.commit ?? "—"}</td>
                <td className="px-2 py-1.5">
                  <div className="flex gap-1">
                    {inst && <a href={`/api/admin/releases?download=${encodeURIComponent(r.channel)}/${encodeURIComponent(inst.name)}`} className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/60 hover:bg-white/10">Ver</a>}
                    {r.rollbackAvailable && <button disabled={!!busy} onClick={() => act("Rollback", { action: "rollback", channel: r.channel, toFull: r.full }, `¿Rollback a ${r.full}?`)} className="rounded border border-amber-400/40 px-1.5 py-0.5 text-[10px] text-amber-200 hover:bg-amber-400/10 disabled:opacity-40">Rollback</button>}
                    {r.channel === "beta" && r.isCurrent && <button disabled={!!busy} onClick={() => act("Promover", { action: "promote", channel: "beta", toChannel: "stable" }, "¿Promover beta → stable?")} className="rounded border border-drl-cyan/40 px-1.5 py-0.5 text-[10px] text-drl-cyan hover:bg-drl-cyan/10 disabled:opacity-40">Promocionar</button>}
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

// ── 10. Logs ──
const LOG_CATS: (LogCategory | "all")[] = ["all", "pipeline", "build", "publish", "provider", "rollback", "updater"];
function Logs({ cc }: { cc: ControlCenterData }) {
  const [cat, setCat] = useState<LogCategory | "all">("all");
  const [q, setQ] = useState("");
  const filtered = cc.logs.filter((l) => (cat === "all" || l.category === cat) && (!q || l.message.toLowerCase().includes(q.toLowerCase())));
  const text = filtered.map((l) => `[${l.category}] ${l.message}`).join("\n");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-white/10 bg-base-800 p-0.5">
          {LOG_CATS.map((c) => <button key={c} onClick={() => setCat(c)} className={cn("rounded px-2 py-0.5 font-display text-[10px] uppercase", cat === c ? "bg-drl text-white" : "text-white/50")}>{c}</button>)}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className="flex-1 min-w-[140px] rounded-lg border border-white/10 bg-base-800 px-2.5 py-1 text-[11px] text-white placeholder:text-white/30 focus:border-drl focus:outline-none" />
        <button onClick={() => navigator.clipboard?.writeText(text)} className="rounded-lg border border-white/15 px-2.5 py-1 text-[10px] uppercase text-white/60 hover:bg-white/10">Copiar</button>
        <a download="drl-logs.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} className="rounded-lg border border-white/15 px-2.5 py-1 text-[10px] uppercase text-white/60 hover:bg-white/10">Exportar</a>
        <span className="text-[10px] text-white/35">{filtered.length}/{cc.logs.length}</span>
      </div>
      <div className="max-h-64 overflow-auto rounded-lg border border-white/10 bg-base-900/60 p-2 font-mono text-[10px]">
        {filtered.length === 0 && <p className="text-white/30">— sin entradas —</p>}
        {filtered.map((l, i) => <p key={i} className={cn(l.level === "error" ? "text-rose-300" : l.level === "warn" ? "text-amber-200" : "text-white/55")}><span className="text-white/25">[{l.category}]</span> {l.message}</p>)}
      </div>
    </div>
  );
}

// ── primitivas ──
type ActFn = (label: string, body: Record<string, unknown>, confirmMsg?: string) => void;
function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-white/10 bg-base-700/40 p-4", className)}><p className="mb-2.5 text-[10px] uppercase tracking-widest text-white/40">{title}</p>{children}</div>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-white/10 bg-base-800/60 p-2 text-center"><p className="font-display text-sm font-bold text-white">{value}</p><p className="text-[9px] uppercase tracking-wide text-white/40">{label}</p></div>;
}
function QBtn({ children, onClick, disabled, tone, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; tone?: "amber" | "cyan"; title?: string }) {
  return <button onClick={onClick} disabled={disabled} title={title} className={cn("rounded-lg border px-3 py-1.5 font-display text-[11px] uppercase tracking-wide transition disabled:opacity-40", tone === "amber" ? "border-amber-400/40 text-amber-200 hover:bg-amber-400/10" : tone === "cyan" ? "border-drl-cyan/40 text-drl-cyan hover:bg-drl-cyan/10" : "border-white/15 text-white/70 hover:bg-white/10")}>{children}</button>;
}
