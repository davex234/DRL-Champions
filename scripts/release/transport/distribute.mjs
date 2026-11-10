/**
 * GLOBAL DISTRIBUTION ENGINE (Fase 6/7) — distribuye UNA release a MÚLTIPLES destinos
 * (región × provider) desde un único pipeline. Tolera fallos parciales, reintenta y verifica.
 *
 *   targets → [publishRelease + Retry] por destino → Health → CDN → Ready (si regiones requeridas OK)
 *
 * REUTILIZA y NO reescribe: publishRelease (Fase 3), rollbackRelease (Fase 5), Transport Engine,
 * Retry Engine, Health Engine, CDN Layer, Provider Manager. Cada destino mantiene SUS manifiestos
 * (latest/meta/files/release/publish/pipeline-state) porque publishRelease se ejecuta tal cual por
 * provider. Escribe `distribution.json` + `analytics.json` (persistidos) para el dashboard.
 *
 * SEGURIDAD: nunca marca Ready si falta una región requerida; los destinos pendientes quedan
 * registrados; no duplica uploads (cada intento es explícito); hashes/firmas los mantiene
 * publishRelease (verify byte-idéntico por destino).
 */
import { join } from "node:path";
import { writeJson } from "../core/fsx.mjs";
import * as Transport from "./engine.mjs";
import { publishRelease } from "./publish.mjs";
import { rollbackRelease } from "./rollback.mjs";
import { withRetry } from "./retry.mjs";
import { probeHealth, buildProviderHealth } from "./health.mjs";
import { buildCdn } from "./cdn.mjs";
import { orderTargets, requiredRegionsOf } from "./manager.mjs";

const groupBy = (rows, key) => rows.reduce((acc, r) => {
  const k = r[key];
  (acc[k] ??= { count: 0, ok: 0, ms: 0, bytes: 0, retries: 0 });
  acc[k].count++; acc[k].ok += r.ok ? 1 : 0; acc[k].ms += r.ms; acc[k].bytes += r.bytes; acc[k].retries += r.retries;
  return acc;
}, {});

function buildRegions(results, cdn) {
  const byRegion = {};
  for (const r of results) (byRegion[r.region] ??= []).push(r);
  return Object.keys(byRegion).sort().map((region) => {
    const rs = byRegion[region];
    const okCount = rs.filter((r) => r.ok).length;
    const cdnReg = cdn.regions.find((g) => g.region === region);
    return {
      region,
      status: okCount === rs.length ? "ok" : okCount > 0 ? "partial" : "failed",
      providers: rs.map((r) => r.provider),
      ok: okCount, total: rs.length,
      pending: rs.filter((r) => !r.ok).map((r) => r.id),
      uploadMs: Math.max(0, ...rs.map((r) => r.uploadMs ?? 0)),
      bytes: rs.reduce((s, r) => s + (r.bytes || 0), 0),
      primary: cdnReg?.primary ?? null,
      mirrors: cdnReg?.mirrors ?? [],
    };
  });
}

const stripTarget = (r) => ({
  id: r.id, region: r.region, provider: r.provider, required: r.required, ok: r.ok, status: r.status,
  pending: r.pending, attempts: r.attempts, retries: r.retries, delays: r.delays,
  ms: r.ms, uploadMs: r.uploadMs, bytes: r.bytes, destination: r.destination, verify: r.verify, error: r.error,
});

/**
 * Distribuye la release a todos los destinos. NO lanza por fallo parcial: devuelve el descriptor
 * de distribución con `ready`/`status` y los destinos pendientes registrados.
 */
export async function distributeRelease({
  release, stagedDir, channel, targets, requiredRegions = null,
  onPhase = () => {}, now = () => Date.now(), keep = 3, retry = {}, date = new Date().toISOString(),
}) {
  const t0 = now();
  const ordered = orderTargets(targets);
  const required = requiredRegions ?? requiredRegionsOf(ordered);
  const results = [];

  for (const target of ordered) {
    onPhase("uploading", { region: target.region, provider: target.provider.name });
    const tStart = now();
    const rr = await withRetry(
      () => publishRelease({ release, stagedDir, channel, provider: target.provider, now, keep }),
      { ...retry, sleep: retry.sleep ?? (async () => {}) },
    );
    const pub = rr.result;
    const ok = rr.ok && pub?.ready === true;
    results.push({
      id: target.id, region: target.region, provider: target.provider.name, required: target.required,
      ok, status: ok ? "ok" : "failed", pending: !ok,
      attempts: rr.attempts, retries: rr.retries, delays: rr.delays,
      ms: now() - tStart, uploadMs: pub?.uploadMs ?? null, bytes: pub?.totalBytes ?? 0,
      destination: pub?.destination ?? target.provider.url(Transport.channelKey(channel, "latest.json")),
      verify: pub?.verify ?? null, error: ok ? null : (rr.error ?? pub?.error ?? "fallo de publicación"),
      publish: ok ? pub : null,
    });
  }

  // Health por destino (probe + analíticas observadas en esta distribución).
  onPhase("verifying", {});
  const healths = [];
  for (const r of results) {
    const target = ordered.find((t) => t.id === r.id);
    const probe = await probeHealth(target.provider, { now });
    const h = buildProviderHealth({
      name: r.provider, region: r.region, probe,
      analytics: { attempts: r.attempts, errors: r.retries + (r.ok ? 0 : 1), bytes: r.bytes, ms: r.ms, avgMs: r.ms, lastPublish: r.ok ? release.full ?? `${release.version}+${release.build}` : null },
    });
    healths.push({ ...h, id: r.id, priority: target.priority, ok: r.ok, destination: r.destination });
  }
  const cdn = buildCdn(healths);

  // READY: cada región REQUERIDA con ≥1 éxito (seguridad: nunca Ready si falta una región).
  const okRegions = new Set(results.filter((r) => r.ok).map((r) => r.region));
  const missingRequired = required.filter((reg) => !okRegions.has(reg));
  const anyOk = results.some((r) => r.ok);
  const ready = missingRequired.length === 0 && anyOk;
  const status = ready ? (results.every((r) => r.ok) ? "ready" : "partial-ready") : (anyOk ? "partial" : "failed");

  const totalMs = now() - t0;
  const analytics = {
    totalMs,
    targets: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    pending: results.filter((r) => r.pending).map((r) => r.id),
    retries: results.reduce((s, r) => s + r.retries, 0),
    bytes: results.reduce((s, r) => s + (r.bytes || 0), 0),
    speedBps: totalMs ? Math.round(results.reduce((s, r) => s + (r.bytes || 0), 0) / Math.max(1, totalMs / 1000)) : 0,
    mirrorsUsed: cdn.regions.reduce((s, r) => s + r.mirrors.length, 0),
    perProvider: groupBy(results, "provider"),
    perRegion: groupBy(results, "region"),
  };

  onPhase(ready ? "published" : "failed", { status });

  const primaryRegion = cdn.regions.find((g) => g.region === cdn.primaryRegion);
  const primaryResult = results.find((r) => r.ok && r.id === primaryRegion?.primary) ?? results.find((r) => r.ok) ?? null;

  const distribution = {
    kind: "distribution",
    channel, full: release.full ?? `${release.version}+${release.build}`,
    version: release.version, build: release.build, date,
    ready, status,
    requiredRegions: required, missingRequired,
    targets: results.map(stripTarget),
    regions: buildRegions(results, cdn),
    cdn, analytics,
    health: healths.map(({ destination, ...h }) => ({ ...h })),
    primary: primaryResult?.publish ?? null,
  };

  // Persistencia: distribution.json + analytics.json en stagedDir y en cada destino con éxito.
  if (stagedDir) {
    writeJson(join(stagedDir, "distribution.json"), distribution);
    writeJson(join(stagedDir, "analytics.json"), { full: distribution.full, channel, generatedAt: date, runs: [analytics] });
    // publish.json del staged = el destino primario (lo que lee el dashboard como "vigente").
    if (primaryResult?.publish) writeJson(join(stagedDir, "publish.json"), primaryResult.publish);
  }
  const distBytes = Buffer.from(JSON.stringify(distribution, null, 2) + "\n");
  for (const r of results.filter((r) => r.ok)) {
    const target = ordered.find((t) => t.id === r.id);
    await target.provider.put({ key: Transport.channelKey(channel, "distribution.json"), bytes: distBytes });
  }

  return distribution;
}

/**
 * ROLLBACK POR REGIÓN — vuelve atrás en cada destino reutilizando rollbackRelease (Fase 5).
 * Si una región falla, NO rompe el rollback de las demás; Ready solo si las requeridas vuelven.
 */
export async function rollbackDistribution({
  targets, channel, toFull, requiredRegions = null, reason = "", user = "system",
  stagedDir = null, now = () => Date.now(), date = new Date().toISOString(), allowUnsigned = false,
}) {
  const ordered = orderTargets(targets);
  const required = requiredRegions ?? requiredRegionsOf(ordered);
  const results = [];
  for (const target of ordered) {
    const rb = await rollbackRelease({ provider: target.provider, channel, toFull, reason, user, now, date, allowUnsigned });
    results.push({ id: target.id, region: target.region, provider: target.provider.name, required: target.required, ok: !!rb.ok, code: rb.code, error: rb.error, verify: rb.verify ?? null });
  }
  const okRegions = new Set(results.filter((r) => r.ok).map((r) => r.region));
  const missingRequired = required.filter((reg) => !okRegions.has(reg));
  const anyOk = results.some((r) => r.ok);
  const ready = missingRequired.length === 0 && anyOk;
  const distribution = {
    kind: "rollback-distribution",
    channel, full: toFull, date, ready,
    status: ready ? (results.every((r) => r.ok) ? "ready" : "partial-ready") : (anyOk ? "partial" : "failed"),
    requiredRegions: required, missingRequired,
    targets: results,
  };
  if (stagedDir) writeJson(join(stagedDir, "distribution.json"), distribution);
  return distribution;
}

export const DistributionEngine = { distributeRelease, rollbackDistribution };
export default DistributionEngine;
