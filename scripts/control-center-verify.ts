/**
 * CONTROL-CENTER-VERIFY — valida el Release Control Center (Fase 7/7).
 *   A) Derivación PURA de las 12 secciones con buildControlCenter sobre un DashboardData fabricado
 *      (panel · pipeline · regiones · providers · rollback · history · analytics · logs · alerts ·
 *      channels · acciones · determinismo · rendimiento).
 *   B) Las acciones REUTILIZAN los motores existentes: promoteServer/retryServer → distributeRelease.
 *
 *   npx tsx scripts/control-center-verify.ts   (o: npm run control-center:verify)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildControlCenter } from "../src/server/releases/control";
import { promoteServer, retryServer } from "../src/server/releases/reader";
import type { DashboardData, ReleaseEntry, DistributionData, ProviderStatus, PipelineState } from "../src/server/releases/types";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra = "") => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const ROOT = process.cwd();

// ── DashboardData fabricado (determinista) ──
const entry = (o: Partial<ReleaseEntry> & { channel: string; full: string }): ReleaseEntry => ({
  channel: o.channel, full: o.full, version: o.full.split("+")[0], build: Number(o.full.split("+")[1] ?? 0),
  date: o.date ?? "2026-06-30T03:00:00.000Z", isCurrent: o.isCurrent ?? false, kind: o.kind ?? "release",
  rolledBackFrom: o.rolledBackFrom ?? null, status: o.status ?? "published", provider: o.provider ?? "local",
  destination: o.destination ?? "file:///pub/latest.json", signed: o.signed ?? true, totalBytes: o.totalBytes ?? 5000,
  uploadMs: o.uploadMs ?? 12, buildMs: o.buildMs ?? 25000, commit: o.commit ?? "abc1234", branch: o.branch ?? "main",
  author: o.author ?? "david", notes: o.notes ?? "Notas", fileCount: o.fileCount ?? 2,
  rollbackAvailable: o.rollbackAvailable ?? false, rollbackTargets: o.rollbackTargets ?? [],
  files: o.files ?? [{ name: "DRLChampionsSetup.exe", size: 5000, sha256: "exehash", url: "file:///pub/exe" }, { name: "files.json", size: 100, sha256: "fileshash" }],
  manifests: o.manifests ?? { hasLatest: true, hasMeta: true, hasFiles: true }, pipeline: o.pipeline ?? null,
  reportMd: o.reportMd ?? null, verify: o.verify ?? { ok: true, checked: 2, mismatches: [], missing: [] }, baseUrl: o.baseUrl ?? "https://u",
});

const pipeline: PipelineState = {
  state: "ready", label: "Ready", error: null, startedAt: 1000, finishedAt: 26000, durationMs: 25000,
  transitions: ["queued", "running", "building", "signing", "manifests", "uploading", "verifying", "published", "ready"].map((s, i) => ({ state: s, at: 1000 + i * 100, elapsedMs: i * 100 })),
};

const distribution: DistributionData = {
  channel: "stable", full: "1.0.3+3", date: "2026-06-30T03:00:00.000Z", ready: false, status: "partial",
  requiredRegions: ["europe", "usa"], missingRequired: ["usa"],
  targets: [
    { id: "eu", region: "europe", provider: "local", required: true, ok: true, status: "ok", pending: false, attempts: 1, retries: 0, ms: 10, uploadMs: 8, bytes: 5100, destination: "file:///eu/latest.json", error: null },
    { id: "us", region: "usa", provider: "local", required: true, ok: false, status: "failed", pending: true, attempts: 3, retries: 5, ms: 30, uploadMs: null, bytes: 0, destination: "file:///us/latest.json", error: "región caída" },
  ],
  regions: [
    { region: "europe", status: "ok", providers: ["local"], ok: 1, total: 1, pending: [], uploadMs: 8, bytes: 5100, primary: "eu", mirrors: [] },
    { region: "usa", status: "failed", providers: ["local"], ok: 0, total: 1, pending: ["us"], uploadMs: 40, bytes: 0, primary: "us", mirrors: [] },
  ],
  cdn: { primaryRegion: "europe", regions: [{ region: "europe", primary: "eu", endpoint: "file:///eu/latest.json", mirrors: [], fallbackOrder: ["eu"], healthy: 1, total: 1 }, { region: "usa", primary: "us", endpoint: null, mirrors: [], fallbackOrder: ["us"], healthy: 0, total: 1 }] },
  analytics: { totalMs: 40, targets: 2, succeeded: 1, failed: 1, retries: 5, bytes: 5100, speedBps: 127500, mirrorsUsed: 0 },
  health: [
    { id: "eu", name: "local", region: "europe", availability: true, latencyMs: 2, score: 85, status: "healthy", speedBps: 600000, errors: 0 },
    { id: "us", name: "local", region: "usa", availability: false, latencyMs: 0, score: 0, status: "down", speedBps: 0, errors: 1 },
  ],
};

const provider = (o: Partial<ProviderStatus> & { name: string }): ProviderStatus => ({
  name: o.name, configured: o.configured ?? true, healthy: o.healthy ?? true, detail: o.detail ?? "ok",
  latencyMs: o.latencyMs ?? 2, sampleUrl: o.sampleUrl ?? "file:///x", lastPublish: o.lastPublish ?? { full: "1.0.3+3", date: "2026-06-30T03:00:00.000Z" },
  errors: o.errors ?? [], active: o.active ?? false,
});

const DATA: DashboardData = {
  generatedAt: "2026-06-30T05:00:00.000Z", root: "/x", channels: ["beta", "stable"], activeProvider: "local",
  releases: [
    entry({ channel: "stable", full: "1.0.3+3", isCurrent: true, pipeline, rollbackAvailable: true, rollbackTargets: ["1.0.2+2"] }),
    entry({ channel: "beta", full: "1.1.0+5", isCurrent: true, signed: true }),
    entry({ channel: "stable", full: "1.0.2+2", date: "2026-06-30T02:00:00.000Z", rollbackAvailable: true }),
  ],
  pipeline,
  providers: [
    provider({ name: "local", active: true, healthy: true }),
    provider({ name: "r2", configured: true, healthy: false, detail: "r2: endpoint 503", errors: ["r2: endpoint 503"] }),
    provider({ name: "github", configured: false, healthy: false, detail: "no configurado" }),
    provider({ name: "filesystem", configured: false, healthy: false, detail: "no configurado" }),
  ],
  health: [],
  stats: { releases: 3, builds: 3, published: 3, failed: 0, rollbackReady: 2, errors: 0, avgBuildMs: 25000, avgUploadMs: 12, avgBytes: 5000, channels: 2, activeProvider: "local" },
  rollbacks: [{ type: "rollback", at: "2026-06-30T04:00:00.000Z", from: "1.0.3+3", to: "1.0.2+2", channel: "stable", provider: "local", user: "admin", reason: "regresión", durationMs: 50, result: "ok", code: "OK", files: 2, signed: true, error: null, reverted: false, verify: { ok: true, checked: 2, mismatches: [], missing: [] } }],
  timeline: [],
  distribution: [distribution],
  errors: [], hasData: true,
};

// ── Fixture en disco para las acciones reales (Part B) ──
function diskFixture() {
  const tmp = mkdtempSync(join(tmpdir(), "drl-cc-"));
  const stage = (channel: string, version: string, build: number) => {
    const dir = join(tmp, "dist", "update", channel);
    mkdirSync(dir, { recursive: true });
    const full = `${version}+${build}`;
    const w = (n: string, o: unknown) => writeFileSync(join(dir, n), typeof o === "string" ? o : JSON.stringify(o));
    w("latest.json", { version, notes: full, pub_date: "2026-06-30T00:00:00Z", platforms: { "windows-x86_64": { signature: `s-${full}`, url: `u/${full}` } } });
    w("meta.json", { version, build, full, pub_date: "2026-06-30T00:00:00Z", platforms: { "windows-x86_64": { size: 100 } } });
    w("files.json", { version, channel, generatedAt: "2026-06-30T00:00:00Z", files: [{ path: "i.html", sha256: `h-${full}`, size: 10 }] });
    w("release.json", { id: `${channel}-${full}`, version, build, full, channel, date: "2026-06-30T00:00:00Z", commit: "c", notes: full, baseUrl: "https://u", files: [{ name: "DRLChampionsSetup.exe", size: 50, sha256: `e-${full}`, signed: true, kind: "installer" }], manifests: { hasLatest: true, hasMeta: true, hasFiles: true }, signed: true, ready: true });
    w("DRLChampionsSetup.exe", `inst-${full}`);
  };
  stage("beta", "1.1.0", 5);
  stage("stable", "1.0.3", 3);
  return { tmp, cleanup: () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } } };
}

(async () => {
  console.log("\n━━━ RELEASE CONTROL CENTER · VERIFY (Fase 7/7) ━━━\n");
  const cc = buildControlCenter(DATA);

  // ── 1. Panel / Release Live ──
  console.log("Panel (Release Live):");
  ok("releaseLive = stable vigente", cc.releaseLive?.channel === "stable" && cc.releaseLive?.full === "1.0.3+3");
  ok("estado global NOC = down (hay críticas)", cc.status === "down");

  // ── 2. Pipeline ──
  console.log("\nPipeline:");
  ok("pipeline presente y ready", cc.pipeline?.state === "ready");
  ok("transiciones incluyen publish/verify/distribute", ["uploading", "verifying", "published"].every((s) => cc.pipeline!.transitions.some((t) => t.state === s)));

  // ── 3. Regiones (Global Map) ──
  console.log("\nGlobal Map:");
  ok("globalMap con 1 canal distribuido", cc.globalMap.length === 1 && cc.globalMap[0].regions.length === 2);
  ok("región usa failed + missingRequired", cc.globalMap[0].missingRequired.includes("usa"));

  // ── 4. Providers ──
  console.log("\nProviders:");
  ok("4 providers", cc.providers.length === 4);
  ok("r2 configurado pero caído", cc.providers.find((p) => p.name === "r2")!.configured && !cc.providers.find((p) => p.name === "r2")!.healthy);

  // ── 5. Release History ──
  console.log("\nRelease History:");
  ok("history = 3 releases", cc.history.length === 3);
  ok("vigentes marcadas", cc.history.filter((r) => r.isCurrent).length === 2);

  // ── 6. Channel Manager ──
  console.log("\nChannel Manager:");
  ok("canales stable + beta", cc.channels.some((c) => c.channel === "stable") && cc.channels.some((c) => c.channel === "beta"));
  ok("diffs calculados (stable vs beta distintas)", cc.channelDiffs.some((d) => d.from === "stable" && d.to === "beta" && d.same === false));

  // ── 7. Rollback Center ──
  console.log("\nRollback Center:");
  ok("eventos de rollback (1)", cc.rollbackCenter.events.length === 1);
  ok("candidatos (rollbackAvailable=2)", cc.rollbackCenter.candidates.length === 2);

  // ── 8. Build Monitor ──
  console.log("\nBuild Monitor:");
  ok("build monitor de la vigente", cc.buildMonitor?.full === "1.0.3+3" && cc.buildMonitor?.artifacts.length === 2);
  ok("CPU/RAM honestos (n/d = null)", cc.buildMonitor?.cpu === null && cc.buildMonitor?.ram === null);
  ok("logs de pipeline en build monitor", (cc.buildMonitor?.logs.length ?? 0) >= 9);

  // ── 9. Analytics ──
  console.log("\nAnalytics:");
  ok("avg build", cc.analytics.avgBuildMs === 25000);
  ok("avg rollback (50ms)", cc.analytics.avgRollbackMs === 50);
  ok("región más lenta = usa", cc.analytics.slowestRegion?.region === "usa");
  ok("provider más rápido = local", cc.analytics.fastestProvider?.name === "local");
  ok("disponibilidad 50% (1/2 configurados sanos)", cc.analytics.availabilityPct === 50);
  ok("retries agregados (5)", cc.analytics.retries === 5);

  // ── 10. Logs ──
  console.log("\nLogs:");
  ok("logs unificados poblados", cc.logs.length > 0);
  ok("categorías presentes (pipeline/rollback/provider)", ["pipeline", "rollback", "provider"].every((c) => cc.logs.some((l) => l.category === c)));

  // ── 11. Alerts ──
  console.log("\nAlerts:");
  const alert = (k: string) => cc.alerts.find((a) => a.key.startsWith(k));
  ok("alerta provider caído (r2)", !!alert("prov-down-r2") && alert("prov-down-r2")!.level === "critical");
  ok("alerta región sin publicar (usa)", !!alert("region-missing") && alert("region-missing")!.level === "critical");
  ok("alerta retry excesivo", !!alert("retries") && alert("retries")!.level === "warning");
  ok("alerta rollback ejecutado", !!alert("rollback-exec"));

  // ── 12. Quick Actions ──
  console.log("\nQuick Actions:");
  ok("canRollback (hay candidato)", cc.quickActions.canRollback === true);
  ok("canPromote beta→stable", cc.quickActions.canPromote === true && cc.quickActions.promoteFrom === "beta" && cc.quickActions.promoteTo === "stable");
  ok("canRetry (distribución parcial)", cc.quickActions.canRetry === true);

  // ── Determinismo ──
  console.log("\nDeterminismo:");
  ok("buildControlCenter puro (misma entrada → misma salida)", JSON.stringify(buildControlCenter(DATA)) === JSON.stringify(buildControlCenter(DATA)));

  // ── Rendimiento ──
  console.log("\nRendimiento:");
  const big: DashboardData = { ...DATA, releases: Array.from({ length: 500 }, (_, i) => entry({ channel: "stable", full: `1.0.${i}+${i}` })) };
  const t0 = Date.now(); buildControlCenter(big); const ms = Date.now() - t0;
  ok(`500 releases en <100ms (${ms}ms)`, ms < 100);

  // ── No reescribe motores (estructural) ──
  console.log("\nReutilización (no nueva lógica):");
  const ctrlSrc = readFileSync(join(ROOT, "src", "server", "releases", "control.ts"), "utf8");
  ok("control.ts NO importa motores .mjs (solo deriva)", !/transport\/.*\.mjs|publishRelease|TransportEngine/.test(ctrlSrc));

  // ── Part B: acciones reutilizan los motores existentes ──
  console.log("\nAcciones reutilizan motores (promote/retry → distributeRelease):");
  const fx = diskFixture();
  try {
    const promo = await promoteServer({ root: fx.tmp, scriptsRoot: ROOT, env: { ...process.env, DRL_PUBLISH_LOCAL_DIR: join(fx.tmp, "dist", "published") } as any, channel: "beta", toChannel: "stable" });
    ok("promote beta→stable ready (reusa distributeRelease)", promo.ready === true);
    ok("stable publicado con artefactos de beta", existsSync(join(fx.tmp, "dist", "published", "stable", "meta.json")) && JSON.parse(readFileSync(join(fx.tmp, "dist", "published", "stable", "meta.json"), "utf8")).version === "1.1.0");
    const retry = await retryServer({ root: fx.tmp, scriptsRoot: ROOT, env: { ...process.env, DRL_PUBLISH_LOCAL_DIR: join(fx.tmp, "dist", "published") } as any, channel: "stable" });
    ok("retry stable ready (reusa distributeRelease)", retry.ready === true);
  } finally { fx.cleanup(); }

  console.log(`\n━━━ Resultado: ${pass} ✓ / ${fail} ✗ ━━━\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
