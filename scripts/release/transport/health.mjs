/**
 * HEALTH ENGINE (Fase 6/7) — calcula automáticamente el estado de cada provider/destino:
 * disponibilidad · latencia · última publicación · errores · tiempo medio · estado · capacidad
 * · velocidad · provider score. Reutiliza TransportEngine.health() (no reimplementa el probe).
 *
 * `score` (0-100) y `status` son DETERMINISTAS dados los inputs.
 */
import * as Transport from "./engine.mjs";

/** Score determinista 0-100 a partir de métricas normalizadas. */
export function scoreOf({ availability = true, latencyMs = 0, errorRate = 0, speedBps = 0 } = {}) {
  if (!availability) return 0;
  const avail = 50;
  const lat = Math.max(0, 25 - Math.min(25, latencyMs / 40)); // 0ms→25, ≥1000ms→0
  const err = Math.max(0, 15 * (1 - Math.min(1, errorRate)));
  const spd = speedBps > 0 ? 10 : 0;
  return Math.round(avail + lat + err + spd);
}

/** Sondea el provider midiendo latencia (reutiliza Transport.health). */
export async function probeHealth(provider, { now = () => Date.now() } = {}) {
  const t0 = now();
  let ok = false, detail = "";
  try { const h = await Transport.health(provider); ok = !!h.ok; detail = h.detail ?? ""; }
  catch (e) { detail = e instanceof Error ? e.message : String(e); }
  return { ok, detail, latencyMs: now() - t0 };
}

/** Construye el estado completo de un destino combinando el probe y las analíticas observadas. */
export function buildProviderHealth({ name, region, probe, analytics = {} }) {
  const attempts = analytics.attempts ?? 0;
  const errorRate = attempts ? (analytics.errors ?? 0) / attempts : 0;
  const speedBps = analytics.bytes && analytics.ms ? Math.round(analytics.bytes / Math.max(1, analytics.ms / 1000)) : 0;
  const score = scoreOf({ availability: probe.ok, latencyMs: probe.latencyMs, errorRate, speedBps });
  const status = !probe.ok ? "down" : score >= 70 ? "healthy" : score >= 40 ? "degraded" : "poor";
  return {
    name, region,
    availability: probe.ok,
    latencyMs: probe.latencyMs,
    lastPublish: analytics.lastPublish ?? null,
    errors: analytics.errors ?? 0,
    avgMs: analytics.avgMs ?? null,
    bytes: analytics.bytes ?? 0,
    speedBps,
    capacity: analytics.capacity ?? "n/a",
    score, status,
    detail: probe.detail,
  };
}

export const HealthEngine = { scoreOf, probeHealth, buildProviderHealth };
export default HealthEngine;
