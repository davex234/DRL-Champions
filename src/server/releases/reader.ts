/**
 * RELEASE DASHBOARD · READER (servidor) — agrega los JSON YA generados por las fases 1-3 en un
 * único payload para el dashboard. NO recrea pipeline/transport/publish: solo LEE y combina:
 *
 *   dist/update/<canal>/      → release.json · publish.json · release-report.json ·
 *                               pipeline-state.json · files/meta/latest.json · RELEASE-REPORT.md
 *   dist/published/<canal>/   → set publicado + releases/history.json (anillo de rollback)
 *
 * El estado de los providers se obtiene del **Transport Engine** real (provider.health()), no se
 * inventa. Sin `@/` imports a propósito: así el harness `dashboard:verify` puede importarlo directo.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  DashboardData, ReleaseEntry, ProviderStatus, HealthItem, PipelineState,
  FileHash, ReleaseStatus, DashboardStats, HealthLevel, RollbackEvent, TimelineEvent,
  DistributionData,
} from "./types";

// ── lectura segura ──
const readJson = <T>(p: string): T | null => {
  try { return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null; } catch { return null; }
};
const readText = (p: string): string | null => {
  try { return existsSync(p) ? readFileSync(p, "utf8") : null; } catch { return null; }
};
const dirs = (p: string): string[] => {
  try { return existsSync(p) ? readdirSync(p).filter((d) => statSync(join(p, d)).isDirectory()) : []; } catch { return []; }
};
const avg = (xs: number[]): number | null => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

// ── shapes de los JSON de las fases previas (parcial, lo que consumimos) ──
interface PublishJson {
  full: string; version: string; build: number; channel: string; date: string;
  provider: string; destination: string; signed: boolean; status: string; ready: boolean;
  error: string | null; uploadMs?: number; totalBytes?: number;
  files?: { name: string; size: number; sha256: string; url?: string }[];
  verify?: { ok: boolean; checked: number; mismatches: string[]; missing: string[] };
  rollbackAvailable?: boolean; rollbackTargets?: string[];
  kind?: string; rolledBackFrom?: string | null;
}
interface ReleaseJson {
  id: string; version: string; build: number; full: string; channel: string; date: string;
  commit: string | null; hash: string | null; notes: string; baseUrl: string;
  files?: { name: string; size: number; sha256: string | null; signed: boolean; kind: string }[];
  manifests?: { hasLatest: boolean; hasMeta: boolean; hasFiles: boolean }; signed: boolean; ready: boolean;
}
interface ReportJson {
  commit: string | null; branch: string | null; author: string | null;
  buildTimeMs: number; status: string; published: boolean;
}
interface HistoryJson {
  channel: string; current: string | null;
  releases: { full: string; files: { name: string; sha256: string; size: number }[]; date?: string; version?: string; build?: number; signed?: boolean; uploadMs?: number }[];
  events?: RollbackEvent[];
}

const ROOT_DEFAULT = process.cwd();
const updateDir = (root: string) => join(root, "dist", "update");
const publishedDir = (root: string) => join(root, "dist", "published");

// ── status normalizado a partir de datos reales ──
function normalizeStatus(publish: PublishJson | null, report: ReportJson | null, state: PipelineState | null): ReleaseStatus {
  if (publish) return publish.ready ? "published" : "failed";
  if (report) return report.status === "READY" ? "ready" : report.status === "FAILED" ? "failed" : "building";
  if (state) return (state.state as ReleaseStatus) ?? "unknown";
  return "unknown";
}

/** Construye la entrada rica de la release vigente de un canal (desde dist/update/<canal>). */
function currentEntry(root: string, channel: string): ReleaseEntry | null {
  const ud = join(updateDir(root), channel);
  const release = readJson<ReleaseJson>(join(ud, "release.json"));
  const publish = readJson<PublishJson>(join(ud, "publish.json"));
  const report = readJson<ReportJson>(join(ud, "release-report.json"));
  const state = readJson<PipelineState>(join(ud, "pipeline-state.json"));
  if (!release && !publish) return null;

  const full = publish?.full ?? release?.full ?? "?";
  const byName = new Map<string, { size: number; sha256: string | null; url?: string }>();
  for (const f of publish?.files ?? []) byName.set(f.name, { size: f.size, sha256: f.sha256, url: f.url });
  for (const f of release?.files ?? []) if (!byName.has(f.name)) byName.set(f.name, { size: f.size, sha256: f.sha256 });

  // Ficheros reales presentes en el directorio (tamaño + mtime), enriquecidos con hash conocido.
  const files: FileHash[] = listArtifacts(ud).map((a) => {
    const known = byName.get(a.name);
    return { name: a.name, size: a.size, mtime: a.mtime, sha256: known?.sha256 ?? null, url: known?.url ?? null };
  });

  const totalBytes = publish?.totalBytes ?? files.reduce((s, f) => s + f.size, 0);
  return {
    channel, full,
    version: publish?.version ?? release?.version ?? "?",
    build: publish?.build ?? release?.build ?? null,
    date: publish?.date ?? release?.date ?? null,
    isCurrent: true,
    kind: publish?.kind === "rollback" ? "rollback" : "release",
    rolledBackFrom: publish?.rolledBackFrom ?? null,
    status: normalizeStatus(publish, report, state),
    provider: publish?.provider ?? null,
    destination: publish?.destination ?? null,
    signed: publish?.signed ?? release?.signed ?? false,
    totalBytes,
    uploadMs: publish?.uploadMs ?? null,
    buildMs: report?.buildTimeMs ?? null,
    commit: report?.commit ?? release?.commit ?? null,
    branch: report?.branch ?? null,
    author: report?.author ?? null,
    notes: release?.notes ?? null,
    fileCount: files.length,
    rollbackAvailable: publish?.rollbackAvailable ?? false,
    rollbackTargets: publish?.rollbackTargets ?? [],
    files,
    manifests: release?.manifests ?? { hasLatest: false, hasMeta: false, hasFiles: false },
    pipeline: state,
    reportMd: readText(join(ud, "RELEASE-REPORT.md")),
    verify: publish?.verify ?? null,
    baseUrl: release?.baseUrl ?? null,
  };
}

/** Lista ficheros (no dirs) de un directorio con tamaño + mtime. */
export function listArtifacts(dir: string): { name: string; size: number; mtime: string }[] {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((n) => { try { return statSync(join(dir, n)).isFile(); } catch { return false; } })
      .sort()
      .map((n) => { const s = statSync(join(dir, n)); return { name: n, size: s.size, mtime: s.mtime.toISOString() }; });
  } catch { return []; }
}

/** Lee el history.json del anillo de un canal (provider local). */
function readChannelHistory(root: string, channel: string): HistoryJson | null {
  return readJson<HistoryJson>(join(publishedDir(root), channel, "releases", "history.json"));
}

/** Releases históricas (anillo) de un canal desde history.json del provider local. */
function historyEntries(hist: HistoryJson | null, channel: string, currentFull: string | null): ReleaseEntry[] {
  if (!hist) return [];
  return hist.releases
    .filter((r) => r.full !== currentFull)
    .map((r): ReleaseEntry => {
      const files: FileHash[] = (r.files ?? []).map((f) => ({ name: f.name, size: f.size, sha256: f.sha256 }));
      return {
        channel, full: r.full,
        version: r.version ?? r.full.split("+")[0],
        build: r.build ?? (r.full.includes("+") ? Number(r.full.split("+")[1]) : null),
        date: r.date ?? null,
        isCurrent: false,
        kind: "release",
        rolledBackFrom: null,
        status: "published",
        provider: null, destination: null,
        signed: r.signed ?? files.some((f) => /\.(exe|msi)$/i.test(f.name)),
        totalBytes: files.reduce((s, f) => s + f.size, 0),
        uploadMs: r.uploadMs ?? null,
        buildMs: null, commit: null, branch: null, author: null, notes: null,
        fileCount: files.length,
        rollbackAvailable: hist.current != null && r.full !== hist.current,
        rollbackTargets: [],
        files, manifests: { hasLatest: false, hasMeta: false, hasFiles: false },
        pipeline: null, reportMd: null, verify: null, baseUrl: null,
      };
    });
}

// ── providers vía Transport Engine real (sin reimplementar nada) ──
interface ProviderLike {
  name: string; configured(): boolean; health(): Promise<{ ok: boolean; detail: string }>;
  url(key: string): string;
}
interface TransportModule {
  FACTORIES: Record<string, (opts: { env: NodeJS.ProcessEnv; root: string }) => ProviderLike>;
  selectProvider(opts: { env: NodeJS.ProcessEnv; root: string }): { provider: ProviderLike };
}

async function loadTransport(root: string): Promise<TransportModule | null> {
  try {
    const url = pathToFileURL(join(root, "scripts", "release", "transport", "provider.mjs")).href;
    return (await import(/* webpackIgnore: true */ url)) as unknown as TransportModule;
  } catch { return null; }
}

async function readProviders(root: string, scriptsRoot: string, env: NodeJS.ProcessEnv, releases: ReleaseEntry[]): Promise<{ providers: ProviderStatus[]; active: string }> {
  const t = await loadTransport(scriptsRoot);
  if (!t) return { providers: [], active: "local" };
  const active = (() => { try { return t.selectProvider({ env, root }).provider.name; } catch { return "local"; } })();
  const names = Object.keys(t.FACTORIES);
  const providers: ProviderStatus[] = [];
  for (const name of names) {
    let configured = false, healthy = false, detail = "", latencyMs: number | null = null, sampleUrl: string | null = null;
    const errors: string[] = [];
    try {
      const p = t.FACTORIES[name]({ env, root });
      configured = p.configured();
      sampleUrl = p.url("stable/latest.json");
      if (configured) {
        const t0 = Date.now();
        const h = await p.health();
        latencyMs = Date.now() - t0;
        healthy = h.ok; detail = h.detail;
        if (!h.ok) errors.push(h.detail);
      } else {
        detail = "no configurado (faltan secrets/destino)";
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      detail = errors[0];
    }
    // Última publicación EXITOSA por este provider (releases ya vienen newest-first).
    const last = releases.find((r) => r.provider === name && (r.status === "published" || r.status === "ready")) ?? null;
    providers.push({
      name, configured, healthy, detail, latencyMs, sampleUrl,
      lastPublish: last ? { full: last.full, date: last.date } : null,
      errors, active: name === active,
    });
  }
  return { providers, active };
}

// ── salud del sistema (datos reales) ──
function buildHealth(root: string, releases: ReleaseEntry[], providers: ProviderStatus[], pipeline: PipelineState | null): HealthItem[] {
  const current = releases.filter((r) => r.isCurrent);
  const anyPublished = current.some((r) => r.status === "published");
  const anyFailed = current.some((r) => r.status === "failed");
  const anyLatest = current.some((r) => r.manifests.hasLatest);
  const prov = (n: string) => providers.find((p) => p.name === n);
  const lvl = (b: boolean, warn = false): HealthLevel => (b ? "green" : warn ? "yellow" : "red");
  const provLvl = (n: string): HealthLevel => {
    const p = prov(n);
    if (!p || !p.configured) return "off";
    return p.healthy ? "green" : "red";
  };
  return [
    { key: "release-system", label: "Release System", level: "green", detail: "Engines presentes (release:arch)" },
    { key: "build-cloud", label: "Build Cloud", level: pipeline ? (pipeline.error ? "red" : "green") : "yellow", detail: pipeline ? `estado ${pipeline.state}` : "sin pipeline-state.json" },
    { key: "publish-cloud", label: "Publish Cloud", level: anyPublished && anyFailed ? "yellow" : anyPublished ? "green" : anyFailed ? "red" : "yellow", detail: anyPublished && anyFailed ? "publicada con algún canal fallido" : anyPublished ? "última publicación verificada" : anyFailed ? "publicación fallida" : "sin publicar" },
    { key: "updater", label: "Updater", level: anyLatest ? "green" : "yellow", detail: anyLatest ? "latest.json presente" : "sin instalador firmado (latest.json)" },
    { key: "transport", label: "Transport", level: providers.some((p) => p.active && p.healthy) ? "green" : "yellow", detail: `provider activo: ${providers.find((p) => p.active)?.name ?? "—"}` },
    { key: "storage", label: "Storage", level: existsSync(join(root, "dist")) ? "green" : "yellow", detail: existsSync(publishedDir(root)) ? "dist/published presente" : "dist presente" },
    { key: "local", label: "Provider · Local", level: provLvl("local"), detail: prov("local")?.detail ?? "—" },
    { key: "filesystem", label: "Provider · Filesystem", level: provLvl("filesystem"), detail: prov("filesystem")?.detail ?? "—" },
    { key: "github", label: "GitHub", level: provLvl("github"), detail: prov("github")?.detail ?? "—" },
    { key: "r2", label: "Cloudflare R2", level: provLvl("r2"), detail: prov("r2")?.detail ?? "—" },
  ];
}

function buildStats(releases: ReleaseEntry[], channels: string[], activeProvider: string): DashboardStats {
  const published = releases.filter((r) => r.status === "published");
  const failed = releases.filter((r) => r.status === "failed");
  const buildMs = releases.map((r) => r.buildMs).filter((x): x is number => x != null);
  const uploadMs = releases.map((r) => r.uploadMs).filter((x): x is number => x != null);
  const bytes = releases.map((r) => r.totalBytes).filter((x) => x > 0);
  return {
    releases: releases.length,
    builds: releases.length,
    published: published.length,
    failed: failed.length,
    rollbackReady: releases.filter((r) => r.rollbackAvailable).length,
    errors: failed.length,
    avgBuildMs: avg(buildMs),
    avgUploadMs: avg(uploadMs),
    avgBytes: avg(bytes),
    channels: channels.length,
    activeProvider,
  };
}

/** Lee y agrega TODO el dashboard. `now` inyectable para tests deterministas. */
export async function readDashboard(opts: { root?: string; scriptsRoot?: string; env?: NodeJS.ProcessEnv; now?: () => string } = {}): Promise<DashboardData> {
  const root = opts.root ?? ROOT_DEFAULT;
  const scriptsRoot = opts.scriptsRoot ?? ROOT_DEFAULT;
  const env = opts.env ?? process.env;
  const now = opts.now ?? (() => new Date().toISOString());
  const errors: string[] = [];

  const channelSet = new Set<string>([...dirs(updateDir(root)), ...dirs(publishedDir(root))]);
  const channels = [...channelSet].sort();

  const releases: ReleaseEntry[] = [];
  const rollbacks: RollbackEvent[] = [];
  const timeline: TimelineEvent[] = [];
  const distribution: DistributionData[] = [];
  for (const channel of channels) {
    const cur = currentEntry(root, channel);
    if (cur) releases.push(cur);
    // Distribución multi-región (Fase 6) — se lee tal cual de distribution.json.
    const dist = readJson<DistributionData & { kind?: string }>(join(updateDir(root), channel, "distribution.json"));
    if (dist && dist.kind !== "rollback-distribution") distribution.push(dist);
    const hist = readChannelHistory(root, channel);
    releases.push(...historyEntries(hist, channel, cur?.full ?? null));
    // Eventos de rollback (log profesional) + línea de tiempo (release ↔ rollback).
    for (const ev of hist?.events ?? []) {
      rollbacks.push(ev);
      timeline.push({ type: "rollback", at: ev.at, channel, full: ev.to, result: ev.result, detail: `Rollback ${ev.from ?? "?"} → ${ev.to}${ev.reason ? ` · ${ev.reason}` : ""}` });
    }
    for (const r of hist?.releases ?? []) {
      timeline.push({ type: "release", at: r.date ?? null, channel, full: r.full, result: "ok", detail: `Release ${r.full}` });
    }
  }
  // Orden: más reciente primero (por fecha, luego build).
  releases.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || (b.build ?? 0) - (a.build ?? 0));
  rollbacks.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  timeline.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  // Pipeline "en tiempo real": el pipeline-state.json más reciente entre los canales vigentes.
  const pipeline = releases.filter((r) => r.isCurrent && r.pipeline).sort((a, b) => (b.pipeline!.startedAt - a.pipeline!.startedAt))[0]?.pipeline ?? null;

  const { providers, active } = await readProviders(root, scriptsRoot, env, releases);
  const health = buildHealth(root, releases, providers, pipeline);
  const stats = buildStats(releases, channels, active);

  return {
    generatedAt: now(), root, channels, activeProvider: active,
    releases, pipeline, providers, health, stats, rollbacks, timeline, distribution, errors,
    hasData: releases.length > 0,
  };
}

// ── Rollback (Fase 5) — orquestación servidor reutilizando el Rollback Engine (.mjs) ──
interface RollbackModule {
  planRollback(a: { provider: unknown; channel: string; toFull: string }): Promise<unknown>;
  rollbackRelease(a: Record<string, unknown>): Promise<{ ok?: boolean; ready?: boolean } & Record<string, unknown>>;
}
async function loadRollback(scriptsRoot: string): Promise<RollbackModule | null> {
  try {
    const url = pathToFileURL(join(scriptsRoot, "scripts", "release", "transport", "rollback.mjs")).href;
    return (await import(/* webpackIgnore: true */ url)) as unknown as RollbackModule;
  } catch { return null; }
}

interface RollbackOpts { root?: string; scriptsRoot?: string; env?: NodeJS.ProcessEnv; channel: string; toFull: string; reason?: string; user?: string }

async function resolveProviderAndEngine(root: string, scriptsRoot: string, env: NodeJS.ProcessEnv) {
  const t = await loadTransport(scriptsRoot);
  const rb = await loadRollback(scriptsRoot);
  if (!t || !rb) throw new Error("sistema de transporte/rollback no disponible");
  const { provider } = t.selectProvider({ env, root });
  return { provider, rb };
}

/** PLAN de rollback (comparación actual vs destino). Solo lectura. */
export async function planRollbackServer(opts: RollbackOpts): Promise<unknown> {
  const root = opts.root ?? ROOT_DEFAULT, scriptsRoot = opts.scriptsRoot ?? ROOT_DEFAULT, env = opts.env ?? process.env;
  const { provider, rb } = await resolveProviderAndEngine(root, scriptsRoot, env);
  return rb.planRollback({ provider, channel: opts.channel, toFull: opts.toFull });
}

/** EJECUTA un rollback real (Transport Engine.rollback + verify + descriptores). */
export async function executeRollbackServer(opts: RollbackOpts): Promise<{ ok?: boolean; ready?: boolean } & Record<string, unknown>> {
  const root = opts.root ?? ROOT_DEFAULT, scriptsRoot = opts.scriptsRoot ?? ROOT_DEFAULT, env = opts.env ?? process.env;
  const { provider, rb } = await resolveProviderAndEngine(root, scriptsRoot, env);
  const stagedDir = join(updateDir(root), opts.channel);
  return rb.rollbackRelease({ provider, channel: opts.channel, toFull: opts.toFull, reason: opts.reason ?? "", user: opts.user ?? "admin", stagedDir });
}

// ── Distribución / Promoción (Fase 6/7) — orquestación servidor reutilizando los motores ──
interface DistributeModule {
  distributeRelease(a: Record<string, unknown>): Promise<{ ready?: boolean } & Record<string, unknown>>;
}
async function loadDistribute(scriptsRoot: string): Promise<(DistributeModule & TransportModule) | null> {
  try {
    const distUrl = pathToFileURL(join(scriptsRoot, "scripts", "release", "transport", "distribute.mjs")).href;
    const provUrl = pathToFileURL(join(scriptsRoot, "scripts", "release", "transport", "manager.mjs")).href;
    const provModUrl = pathToFileURL(join(scriptsRoot, "scripts", "release", "transport", "provider.mjs")).href;
    const dist = await import(/* webpackIgnore: true */ distUrl);
    const mgr = await import(/* webpackIgnore: true */ provUrl);
    const prov = await import(/* webpackIgnore: true */ provModUrl);
    return { ...(dist as object), ...(mgr as object), ...(prov as object) } as unknown as DistributeModule & TransportModule;
  } catch { return null; }
}

interface ChannelActionOpts { root?: string; scriptsRoot?: string; env?: NodeJS.ProcessEnv; channel: string; toChannel?: string; user?: string }

/** Lee el objeto Release staged de un canal (para promover/reintentar sin recompilar). */
function readStagedRelease(root: string, channel: string): Record<string, unknown> | null {
  return readJson<Record<string, unknown>>(join(updateDir(root), channel, "release.json"));
}

/** REINTENTA la distribución de un canal (reutiliza distributeRelease con los mismos targets). */
export async function retryServer(opts: ChannelActionOpts): Promise<{ ready?: boolean } & Record<string, unknown>> {
  const root = opts.root ?? ROOT_DEFAULT, scriptsRoot = opts.scriptsRoot ?? ROOT_DEFAULT, env = opts.env ?? process.env;
  const mod = await loadDistribute(scriptsRoot);
  if (!mod) throw new Error("distribution engine no disponible");
  const release = readStagedRelease(root, opts.channel);
  if (!release) throw new Error(`sin release.json staged para el canal ${opts.channel}`);
  const targets = (mod as unknown as { buildTargets: (o: object) => unknown[] }).buildTargets({ env, root });
  const stagedDir = join(updateDir(root), opts.channel);
  return mod.distributeRelease({ release, stagedDir, channel: opts.channel, targets });
}

/**
 * PROMUEVE un canal a otro (p.ej. beta→stable) republicando los MISMOS artefactos staged del
 * origen al canal destino. Reutiliza distributeRelease — NO crea versiones nuevas, NO recompila.
 */
export async function promoteServer(opts: ChannelActionOpts): Promise<{ ready?: boolean } & Record<string, unknown>> {
  const root = opts.root ?? ROOT_DEFAULT, scriptsRoot = opts.scriptsRoot ?? ROOT_DEFAULT, env = opts.env ?? process.env;
  const toChannel = opts.toChannel;
  if (!toChannel) throw new Error("falta canal destino");
  const mod = await loadDistribute(scriptsRoot);
  if (!mod) throw new Error("distribution engine no disponible");
  const release = readStagedRelease(root, opts.channel);
  if (!release) throw new Error(`sin release.json staged en el canal origen ${opts.channel}`);
  const targets = (mod as unknown as { buildTargets: (o: object) => unknown[] }).buildTargets({ env, root });
  // stagedDir = artefactos del ORIGEN; channel = DESTINO → republicación a otro canal.
  const stagedDir = join(updateDir(root), opts.channel);
  return mod.distributeRelease({ release: { ...release, channel: toChannel }, stagedDir, channel: toChannel, targets });
}

/** Resuelve un artefacto a bytes para descarga/copia de URL (admin). Seguridad: sin `..`. */
export function resolveArtifact(root: string, channel: string, name: string): string | null {
  if (/[\\/]/.test(name) || name.includes("..") || /[\\/]/.test(channel) || channel.includes("..")) return null;
  for (const base of [join(updateDir(root), channel), join(publishedDir(root), channel)]) {
    const p = join(base, name);
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}
