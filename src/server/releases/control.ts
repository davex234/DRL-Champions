/**
 * RELEASE CONTROL CENTER · MODEL (Fase 7/7) — capa de ORQUESTACIÓN PURA. NO crea motores ni
 * obtiene datos: DERIVA las 12 secciones del NOC a partir del `DashboardData` que ya produce el
 * reader (Fases 4-6). Determinista: misma entrada → misma salida (sin reloj propio).
 *
 *   Release Live · Pipeline · Global Map · Providers · History · Channels · Rollback Center ·
 *   Build Monitor · Analytics · Logs · Alerts · Quick Actions
 */
import type {
  DashboardData, ReleaseEntry, PipelineState, ProviderStatus, RollbackEvent,
  DistributionData, FileHash,
} from "./types";

export type AlertLevel = "critical" | "warning" | "info";
export type LogCategory = "build" | "publish" | "rollback" | "provider" | "updater" | "pipeline";
export type NocStatus = "operational" | "degraded" | "down";

export interface CcAlert { level: AlertLevel; key: string; title: string; detail: string; at: string | null }
export interface CcLog { at: string | null; category: LogCategory; level: "info" | "warn" | "error"; message: string }
export interface CcChannel {
  channel: string; full: string | null; version: string | null; status: string;
  signed: boolean; date: string | null; provider: string | null; rollbackAvailable: boolean;
}
export interface CcChannelDiff { from: string; to: string; same: boolean; fromFull: string | null; toFull: string | null }
export interface CcAnalytics {
  avgBuildMs: number | null; avgPublishMs: number | null; avgRollbackMs: number | null;
  slowestRegion: { region: string; ms: number } | null;
  fastestProvider: { name: string; latencyMs: number } | null;
  errors: number; retries: number; builds: number; releases: number; rollbacks: number;
  availabilityPct: number;
}
export interface CcBuildMonitor {
  full: string | null; buildMs: number | null; signed: boolean; totalBytes: number;
  artifacts: FileHash[]; logs: string[]; cpu: number | null; ram: number | null; note: string;
}
export interface CcQuickActions {
  canRollback: boolean; canRetry: boolean; canDownload: boolean;
  canPromote: boolean; promoteFrom: string | null; promoteTo: string | null;
  rollbackChannel: string | null; rollbackTarget: string | null;
}
export interface ControlCenterData {
  generatedAt: string;
  status: NocStatus;
  releaseLive: ReleaseEntry | null;
  pipeline: PipelineState | null;
  globalMap: DistributionData[];
  providers: ProviderStatus[];
  history: ReleaseEntry[];
  channels: CcChannel[];
  channelDiffs: CcChannelDiff[];
  rollbackCenter: { events: RollbackEvent[]; candidates: ReleaseEntry[] };
  buildMonitor: CcBuildMonitor | null;
  analytics: CcAnalytics;
  logs: CcLog[];
  alerts: CcAlert[];
  quickActions: CcQuickActions;
}

const CHANNEL_ORDER = ["stable", "beta", "developer", "nightly"];
const avg = (xs: number[]): number | null => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Deriva el modelo completo del Control Center. PURO. */
export function buildControlCenter(data: DashboardData): ControlCenterData {
  const current = data.releases.filter((r) => r.isCurrent);
  // "Release live" = el canal estable vigente, o el más reciente vigente.
  const releaseLive = current.find((r) => r.channel === "stable") ?? current[0] ?? data.releases[0] ?? null;

  // ── Channels (manager): vigente por canal + diffs ──
  const byChannel = new Map<string, ReleaseEntry>();
  for (const r of current) if (!byChannel.has(r.channel)) byChannel.set(r.channel, r);
  const channels: CcChannel[] = CHANNEL_ORDER.filter((c) => byChannel.has(c) || data.channels.includes(c)).map((channel) => {
    const r = byChannel.get(channel) ?? null;
    return {
      channel, full: r?.full ?? null, version: r?.version ?? null, status: r?.status ?? "—",
      signed: r?.signed ?? false, date: r?.date ?? null, provider: r?.provider ?? null,
      rollbackAvailable: r?.rollbackAvailable ?? false,
    };
  });
  const channelDiffs: CcChannelDiff[] = [];
  for (let i = 0; i < channels.length; i++) {
    for (let j = i + 1; j < channels.length; j++) {
      const a = channels[i], b = channels[j];
      channelDiffs.push({ from: a.channel, to: b.channel, fromFull: a.full, toFull: b.full, same: !!a.full && a.full === b.full });
    }
  }

  // ── Analytics (agregados de datos reales) ──
  const rbDurations = data.rollbacks.map((e) => e.durationMs).filter((x): x is number => x != null);
  const distAll = data.distribution;
  const slowestRegion = distAll.flatMap((d) => d.regions.map((r) => ({ region: r.region, ms: r.uploadMs })))
    .sort((a, b) => b.ms - a.ms)[0] ?? null;
  const healthyProviders = data.providers.filter((p) => p.configured && p.healthy && p.latencyMs != null);
  const fastestProvider = healthyProviders.slice().sort((a, b) => (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9))[0] ?? null;
  const configured = data.providers.filter((p) => p.configured);
  const availabilityPct = configured.length ? Math.round((configured.filter((p) => p.healthy).length / configured.length) * 100) : 100;
  const analytics: CcAnalytics = {
    avgBuildMs: data.stats.avgBuildMs,
    avgPublishMs: avg(distAll.map((d) => d.analytics.totalMs).filter((x) => x > 0)) ?? data.stats.avgUploadMs,
    avgRollbackMs: avg(rbDurations),
    slowestRegion,
    fastestProvider: fastestProvider ? { name: fastestProvider.name, latencyMs: fastestProvider.latencyMs ?? 0 } : null,
    errors: data.stats.errors + data.rollbacks.filter((e) => e.result === "failed").length,
    retries: distAll.reduce((s, d) => s + (d.analytics.retries ?? 0), 0),
    builds: data.stats.builds,
    releases: data.stats.releases,
    rollbacks: data.rollbacks.length,
    availabilityPct,
  };

  // ── Build Monitor (de los datos existentes; sin telemetría de CPU/RAM) ──
  const buildMonitor: CcBuildMonitor | null = releaseLive ? {
    full: releaseLive.full, buildMs: releaseLive.buildMs, signed: releaseLive.signed,
    totalBytes: releaseLive.totalBytes, artifacts: releaseLive.files,
    logs: (releaseLive.pipeline?.transitions ?? []).map((t) => `${t.state} (+${t.elapsedMs}ms)`),
    cpu: null, ram: null,
    note: "CPU/RAM no instrumentados (sin telemetría de runner); resto desde datos reales.",
  } : null;

  // ── Logs unificados (derivados de pipeline + rollbacks + distribución) ──
  const logs: CcLog[] = [];
  for (const t of data.pipeline?.transitions ?? []) logs.push({ at: null, category: "pipeline", level: "info", message: `pipeline → ${t.state} (+${t.elapsedMs}ms)` });
  for (const e of data.rollbacks) logs.push({ at: e.at, category: "rollback", level: e.result === "ok" ? "info" : "error", message: `rollback ${e.from ?? "?"}→${e.to} (${e.channel}) · ${e.result}${e.error ? `: ${e.error}` : ""}` });
  for (const d of distAll) for (const t of d.targets) logs.push({ at: d.date, category: t.ok ? "publish" : "provider", level: t.ok ? "info" : "error", message: `distribución ${d.channel} · ${t.region}/${t.provider}: ${t.status}${t.retries ? ` (retries ${t.retries})` : ""}` });
  for (const p of data.providers) if (p.configured && !p.healthy) logs.push({ at: null, category: "provider", level: "error", message: `provider ${p.name} no saludable: ${p.detail}` });
  logs.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  // ── Alerts (eventos reales) ──
  const alerts: CcAlert[] = [];
  for (const r of current) if (r.status === "failed") alerts.push({ level: "critical", key: `rel-fail-${r.channel}`, title: "Release fallida", detail: `${r.channel} ${r.full} en estado failed`, at: r.date });
  for (const p of data.providers) if (p.configured && !p.healthy) alerts.push({ level: "critical", key: `prov-down-${p.name}`, title: "Provider caído", detail: `${p.name}: ${p.detail}`, at: null });
  for (const d of distAll) {
    if (d.missingRequired.length) alerts.push({ level: "critical", key: `region-missing-${d.channel}`, title: "Región sin publicar", detail: `${d.channel}: faltan ${d.missingRequired.join(", ")}`, at: d.date });
    if ((d.analytics.retries ?? 0) > 3) alerts.push({ level: "warning", key: `retries-${d.channel}`, title: "Retry excesivo", detail: `${d.channel}: ${d.analytics.retries} reintentos`, at: d.date });
  }
  const lastRb = data.rollbacks[0];
  if (lastRb) alerts.push({ level: lastRb.result === "ok" ? "info" : "warning", key: "rollback-exec", title: "Rollback ejecutado", detail: `${lastRb.from ?? "?"}→${lastRb.to} (${lastRb.channel}) · ${lastRb.result}`, at: lastRb.at });
  for (const r of current) if (r.channel === "stable" && r.verify && !r.verify.ok) alerts.push({ level: "warning", key: "sig-invalid", title: "Verificación inválida", detail: `${r.full}: ${r.verify.mismatches.length} difieren, ${r.verify.missing.length} faltan`, at: r.date });

  // ── Quick actions (capacidades derivadas; los botones llaman a los motores existentes) ──
  const beta = byChannel.get("beta") ?? null;
  const rbCandidate = data.releases.find((r) => r.rollbackAvailable) ?? null;
  const quickActions: CcQuickActions = {
    canRollback: !!rbCandidate,
    canRetry: distAll.some((d) => d.status === "partial" || d.missingRequired.length > 0),
    canDownload: !!releaseLive && releaseLive.files.length > 0,
    canPromote: !!beta && beta.status === "published",
    promoteFrom: beta ? "beta" : null,
    promoteTo: beta ? "stable" : null,
    rollbackChannel: rbCandidate?.channel ?? null,
    rollbackTarget: rbCandidate?.rollbackTargets?.[0] ?? rbCandidate?.full ?? null,
  };

  // ── Estado global del NOC ──
  const status: NocStatus = alerts.some((a) => a.level === "critical") ? "down" : alerts.some((a) => a.level === "warning") ? "degraded" : "operational";

  return {
    generatedAt: data.generatedAt,
    status,
    releaseLive,
    pipeline: data.pipeline,
    globalMap: distAll,
    providers: data.providers,
    history: data.releases,
    channels, channelDiffs,
    rollbackCenter: { events: data.rollbacks, candidates: data.releases.filter((r) => r.rollbackAvailable) },
    buildMonitor,
    analytics,
    logs,
    alerts,
    quickActions,
  };
}
