/**
 * DISTRIBUTION-VERIFY — valida el Global Distribution Engine (Fase 6/7) sin red ni build:
 * distribuye a varias regiones/providers locales y comprueba múltiples providers · regiones ·
 * fallos parciales · retries · fallback/CDN · rollback por región · dashboard · manifests ·
 * updater/cliente · determinismo · rendimiento.
 *
 *   npx tsx scripts/distribution-verify.ts   (o: npm run distribution:verify)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import DistributeDefault from "./release/transport/distribute.mjs";
import RetryDefault from "./release/transport/retry.mjs";
import EngineDefault from "./release/transport/engine.mjs";
import LocalDefault from "./release/transport/providers/local.mjs";
import { readDashboard } from "../src/server/releases/reader";

const { distributeRelease, rollbackDistribution } = DistributeDefault as any;
const { backoffDelay } = RetryDefault as any;
const TransportEngine = EngineDefault as any;
const { createLocalProvider } = LocalDefault as any;

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra = "") => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const ROOT = process.cwd();
const counterNow = () => { let t = 1000; return () => (t += 5); };

/** Fixture multi-región con providers locales en directorios distintos (= regiones). */
function fixture(tmp = mkdtempSync(join(tmpdir(), "drl-dist-"))) {
  const channel = "stable";
  const stagedDir = join(tmp, "dist", "update", channel);
  const regionProvider = (region: string) =>
    createLocalProvider({ env: { DRL_PUBLISH_LOCAL_DIR: join(tmp, "dist", "published", region) } as any, root: tmp });
  // Provider que "cae" (health falla) → publishRelease devuelve ready:false → reintentos.
  const downProvider = (region: string) => ({ ...regionProvider(region), health: async () => ({ ok: false, detail: "región caída" }) });

  const stage = (version: string, build: number, signed = true) => {
    mkdirSync(stagedDir, { recursive: true });
    const full = `${version}+${build}`;
    const w = (name: string, obj: unknown) => writeFileSync(join(stagedDir, name), typeof obj === "string" ? obj : JSON.stringify(obj));
    w("latest.json", { version, notes: full, pub_date: "2026-06-30T00:00:00Z", platforms: { "windows-x86_64": { signature: `s-${full}`, url: `u/${full}` } } });
    w("meta.json", { version, build, full, pub_date: "2026-06-30T00:00:00Z", platforms: { "windows-x86_64": { size: 100 } } });
    w("files.json", { version, channel, generatedAt: "2026-06-30T00:00:00Z", files: [{ path: "index.html", sha256: `h-${full}`, size: 10 }] });
    w("release.json", { id: `${channel}-${full}`, version, build, full, channel, date: `2026-06-3${build}T00:00:00Z`, commit: `c${build}`, notes: `Notas ${full}`, baseUrl: "https://u", files: [{ name: "DRLChampionsSetup.exe", size: 50, sha256: `e-${full}`, signed, kind: "installer" }], manifests: { hasLatest: true, hasMeta: true, hasFiles: true }, signed, ready: true });
    w("DRLChampionsSetup.exe", `installer-${full}`);
    return { id: `${channel}-${full}`, version, build, full, channel, date: `2026-06-3${build}T00:00:00Z`, signed };
  };
  return { tmp, channel, stagedDir, regionProvider, downProvider, stage, cleanup: () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } } };
}

const RETRY = { max: 3, base: 50, sleep: async () => {} };

(async () => {
  console.log("\n━━━ GLOBAL DISTRIBUTION ENGINE · VERIFY (Fase 6/7) ━━━\n");

  // ── 1. Retry Engine determinista ──
  console.log("Retry Engine (determinista):");
  ok("backoff exponencial", backoffDelay(1, { base: 100 }) === 100 && backoffDelay(2, { base: 100 }) === 200 && backoffDelay(3, { base: 100 }) === 400);
  ok("backoff acotado por maxDelay", backoffDelay(20, { base: 100, maxDelay: 1000 }) === 1000);

  // ── 2. Distribución multi-región (todas OK) ──
  console.log("\nDistribución multi-región (todas OK):");
  const f = fixture();
  const targets = [
    { id: "eu", region: "europe", provider: f.regionProvider("europe"), priority: 1, required: true },
    { id: "us", region: "usa", provider: f.regionProvider("usa"), priority: 2, required: true },
    { id: "asia", region: "asia", provider: f.regionProvider("asia"), priority: 3, required: false },
  ];
  const rel = f.stage("1.0.0", 1);
  const dist = await distributeRelease({ release: rel as any, stagedDir: f.stagedDir, channel: f.channel, targets, retry: RETRY });
  ok("ready=true (todas las regiones OK)", dist.ready === true && dist.status === "ready");
  ok("3 regiones, 3 destinos OK", dist.regions.length === 3 && dist.analytics.succeeded === 3);
  ok("cada región publicó su manifest", await (async () => {
    for (const t of targets) { const b = await t.provider.getBytes(TransportEngine.channelKey(f.channel, "latest.json")); if (!b) return false; } return true;
  })());

  // ── 3. Manifests por región + updater/cliente ──
  console.log("\nManifests por región (updater/cliente):");
  const euMeta = JSON.parse((await targets[0].provider.getBytes(TransportEngine.channelKey(f.channel, "meta.json")))!.toString());
  ok("meta.json por región = versión release", euMeta.version === "1.0.0" && euMeta.full === "1.0.0+1");
  ok("distribution.json en cada región", await (async () => {
    for (const t of targets) if (!(await t.provider.getBytes(TransportEngine.channelKey(f.channel, "distribution.json")))) return false; return true;
  })());

  // ── 4. CDN / fallback ──
  console.log("\nCDN / fallback:");
  ok("región primaria definida", !!dist.cdn.primaryRegion);
  ok("cada región tiene primary + fallbackOrder", dist.cdn.regions.every((r: any) => r.primary && r.fallbackOrder.length >= 1));
  ok("mirrors calculados", dist.regions.every((r: any) => Array.isArray(r.mirrors)));

  // ── 5. Rendimiento (analítica capturada) ──
  console.log("\nRendimiento / analytics:");
  ok("totalMs y velocidad capturados", typeof dist.analytics.totalMs === "number" && typeof dist.analytics.speedBps === "number");
  ok("perRegion y perProvider presentes", !!dist.analytics.perRegion.europe && !!dist.analytics.perProvider.local);
  ok("bytes agregados", dist.analytics.bytes > 0);
  f.cleanup();

  // ── 6. Fallo parcial de región REQUERIDA → no Ready (seguridad) ──
  console.log("\nFallo parcial (región requerida) → NO Ready:");
  const g = fixture();
  const gt = [
    { id: "eu", region: "europe", provider: g.regionProvider("europe"), priority: 1, required: true },
    { id: "us", region: "usa", provider: g.downProvider("usa"), priority: 2, required: true },
    { id: "asia", region: "asia", provider: g.regionProvider("asia"), priority: 3, required: false },
  ];
  const gd = await distributeRelease({ release: g.stage("1.0.0", 1) as any, stagedDir: g.stagedDir, channel: g.channel, targets: gt, retry: RETRY });
  ok("USA falla pero EU/Asia continúan", gd.regions.find((r: any) => r.region === "europe").status === "ok" && gd.regions.find((r: any) => r.region === "asia").status === "ok");
  ok("status partial + NO ready (región requerida faltante)", gd.ready === false && gd.status === "partial");
  ok("missingRequired incluye usa", gd.missingRequired.includes("usa"));
  ok("USA pendiente registrado", gd.targets.find((t: any) => t.region === "usa").pending === true);
  ok("USA reintentó (retries = max-1)", gd.targets.find((t: any) => t.region === "usa").retries === RETRY.max - 1);
  g.cleanup();

  // ── 7. Fallo de región NO requerida → Ready parcial ──
  console.log("\nFallo de región NO requerida → Ready parcial:");
  const h = fixture();
  const ht = [
    { id: "eu", region: "europe", provider: h.regionProvider("europe"), priority: 1, required: true },
    { id: "asia", region: "asia", provider: h.downProvider("asia"), priority: 2, required: false },
  ];
  const hd = await distributeRelease({ release: h.stage("1.0.0", 1) as any, stagedDir: h.stagedDir, channel: h.channel, targets: ht, retry: RETRY });
  ok("ready=true (la requerida EU está OK)", hd.ready === true && hd.status === "partial-ready");
  ok("asia pendiente pero no bloquea", hd.missingRequired.length === 0 && hd.targets.find((t: any) => t.region === "asia").pending);
  h.cleanup();

  // ── 8. Multi-canal (aislamiento) ──
  console.log("\nMulti-canal (aislamiento):");
  const c = fixture();
  const ct = [{ id: "eu", region: "europe", provider: c.regionProvider("europe"), priority: 1, required: true }];
  await distributeRelease({ release: c.stage("1.0.0", 1) as any, stagedDir: c.stagedDir, channel: "stable", targets: ct, retry: RETRY });
  await distributeRelease({ release: c.stage("2.0.0", 1) as any, stagedDir: c.stagedDir, channel: "beta", targets: ct, retry: RETRY });
  const stableLatest = JSON.parse((await ct[0].provider.getBytes(TransportEngine.channelKey("stable", "meta.json")))!.toString());
  const betaLatest = JSON.parse((await ct[0].provider.getBytes(TransportEngine.channelKey("beta", "meta.json")))!.toString());
  ok("canales stable/beta aislados en el provider", stableLatest.version === "1.0.0" && betaLatest.version === "2.0.0");
  c.cleanup();

  // ── 9. Rollback por región (reusa rollbackRelease) ──
  console.log("\nRollback por región:");
  const r = fixture();
  const rt = [
    { id: "eu", region: "europe", provider: r.regionProvider("europe"), priority: 1, required: true },
    { id: "us", region: "usa", provider: r.regionProvider("usa"), priority: 2, required: true },
  ];
  await distributeRelease({ release: r.stage("5.0.1", 1) as any, stagedDir: r.stagedDir, channel: r.channel, targets: rt, retry: RETRY });
  await distributeRelease({ release: r.stage("5.0.2", 2) as any, stagedDir: r.stagedDir, channel: r.channel, targets: rt, retry: RETRY });
  const rbd = await rollbackDistribution({ targets: rt, channel: r.channel, toFull: "5.0.1+1", reason: "regional", user: "ops", stagedDir: r.stagedDir });
  ok("rollback de todas las regiones OK + ready", rbd.ready === true && rbd.targets.every((t: any) => t.ok));
  ok("EU vigente = 5.0.1+1", (await TransportEngine.readHistory(rt[0].provider, r.channel)).current === "5.0.1+1");
  ok("USA vigente = 5.0.1+1", (await TransportEngine.readHistory(rt[1].provider, r.channel)).current === "5.0.1+1");
  // Una región falla el rollback (archivo corrupto) → no rompe la otra.
  await rt[1].provider.put({ key: TransportEngine.archiveKey(r.channel, "5.0.2+2", "latest.json"), bytes: Buffer.from("CORRUPTO") });
  const rbd2 = await rollbackDistribution({ targets: rt, channel: r.channel, toFull: "5.0.2+2", requiredRegions: ["europe", "usa"], stagedDir: r.stagedDir });
  ok("EU rollback OK aunque USA falle", rbd2.targets.find((t: any) => t.region === "europe").ok === true);
  ok("USA falla → not ready (requerida)", rbd2.targets.find((t: any) => t.region === "usa").ok === false && rbd2.ready === false);
  r.cleanup();

  // ── 10. Dashboard refleja la distribución ──
  console.log("\nDashboard:");
  const d = fixture();
  const dt = [
    { id: "eu", region: "europe", provider: d.regionProvider("europe"), priority: 1, required: true },
    { id: "us", region: "usa", provider: d.regionProvider("usa"), priority: 2, required: true },
  ];
  await distributeRelease({ release: d.stage("9.0.0", 1) as any, stagedDir: d.stagedDir, channel: d.channel, targets: dt, retry: RETRY });
  const dash = await readDashboard({ root: d.tmp, scriptsRoot: ROOT, env: { ...process.env } });
  ok("dashboard.distribution poblado", dash.distribution.length === 1);
  ok("dashboard: 2 regiones + cdn + analytics", dash.distribution[0].regions.length === 2 && !!dash.distribution[0].cdn.primaryRegion && dash.distribution[0].analytics.succeeded === 2);
  ok("dashboard: status ready", dash.distribution[0].status === "ready" && dash.distribution[0].ready === true);
  d.cleanup();

  // ── 11. Determinismo ──
  console.log("\nDeterminismo:");
  const runDet = async () => {
    const fx = fixture();
    const tg = [
      { id: "eu", region: "europe", provider: fx.regionProvider("europe"), priority: 1, required: true },
      { id: "us", region: "usa", provider: fx.regionProvider("usa"), priority: 2, required: true },
    ];
    const out = await distributeRelease({ release: fx.stage("7.0.0", 1) as any, stagedDir: fx.stagedDir, channel: fx.channel, targets: tg, retry: RETRY, now: counterNow(), date: "2026-06-30T00:00:00.000Z" });
    // Normaliza la ruta temporal en sus 3 formas: forward-slash (URLs file://), backslash
    // escapado (JSON) y crudo. El sufijo aleatorio del tmp es lo único volátil.
    const fwd = fx.tmp.split("\\").join("/");
    const esc = fx.tmp.split("\\").join("\\\\");
    const norm = JSON.stringify(out).split(fwd).join("<TMP>").split(esc).join("<TMP>").split(fx.tmp).join("<TMP>");
    fx.cleanup();
    return norm;
  };
  ok("dos distribuciones idénticas → resultado idéntico", (await runDet()) === (await runDet()));

  console.log(`\n━━━ Resultado: ${pass} ✓ / ${fail} ✗ ━━━\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
