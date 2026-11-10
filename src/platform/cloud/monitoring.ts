/**
 * MONITORING · HEALTH · DISTRIBUTED LOGGING · CRASH/RECOVERY · DASHBOARDS (Online Fase 7/7).
 *
 * Observabilidad de la plataforma: health checks agregados sobre las instancias, log distribuido
 * estructurado, ingesta de crash reports + recuperación, y DASHBOARDS derivados (performance/server/
 * live) que solo LEEN el estado de los otros módulos. Determinista (reloj lógico). Sin efectos.
 */
import type { InstanceManager } from "./servers";
import type { LiveMatchRegistry, LiveTournamentRegistry, PresenceSync } from "./registry";
import type { Metrics } from "./analytics";
import type { HealthStatus } from "./types";

// ───────────────────────────── Distributed logging ─────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";
export interface DistLogEntry { at: number; level: LogLevel; source: string; msg: string }

export class DistributedLog {
  private entries: DistLogEntry[] = [];
  private cap: number;
  constructor(cap = 10000) { this.cap = cap; }
  log(level: LogLevel, source: string, msg: string, at: number): void {
    this.entries.push({ at, level, source, msg });
    if (this.entries.length > this.cap) this.entries.shift();
  }
  tail(n = 50): DistLogEntry[] { return this.entries.slice(-n); }
  byLevel(level: LogLevel): DistLogEntry[] { return this.entries.filter((e) => e.level === level); }
  count(): number { return this.entries.length; }
}

// ───────────────────────────── Crash / recovery ─────────────────────────────

export interface CrashRecord { id: string; instanceId: string; at: number; kind: string; recovered: boolean; recoveredAt: number | null }

export class CrashReporter {
  private crashes: CrashRecord[] = [];
  report(instanceId: string, kind: string, at: number): CrashRecord {
    const c: CrashRecord = { id: `crash-${this.crashes.length}`, instanceId, at, kind, recovered: false, recoveredAt: null };
    this.crashes.push(c);
    return c;
  }
  markRecovered(id: string, at: number): void { const c = this.crashes.find((x) => x.id === id); if (c) { c.recovered = true; c.recoveredAt = at; } }
  open(): CrashRecord[] { return this.crashes.filter((c) => !c.recovered); }
  all(): CrashRecord[] { return this.crashes.slice(); }
}

// ───────────────────────────── Health checks ─────────────────────────────

export interface HealthReport { overall: HealthStatus; instances: number; healthy: number; degraded: number; down: number; loadFactor: number }

export class HealthChecker {
  constructor(private instances: InstanceManager) {}
  check(now: number): HealthReport {
    this.instances.sweep(now);
    const all = this.instances.all();
    const healthy = all.filter((i) => i.state !== "down" && i.health === "healthy").length;
    const degraded = all.filter((i) => i.state !== "down" && i.health === "degraded").length;
    const down = all.filter((i) => i.state === "down").length;
    const alive = all.length - down;
    const overall: HealthStatus = alive === 0 ? "unhealthy" : down > alive ? "unhealthy" : degraded > 0 || down > 0 ? "degraded" : "healthy";
    return { overall, instances: all.length, healthy, degraded, down, loadFactor: Math.round(this.instances.loadFactor() * 100) / 100 };
  }
}

// ───────────────────────────── Dashboards (solo lectura) ─────────────────────────────

export interface ServerDashboard { regions: Record<string, { instances: number; load: number; capacity: number }>; totalInstances: number; totalLoad: number }
export interface LiveDashboard { liveMatches: number; liveTournaments: number; onlineUsers: number; byStatus: Record<string, number> }
export interface PerformanceDashboard { counters: Record<string, number>; gauges: Record<string, number>; p50: number; p95: number }

export class Dashboards {
  constructor(
    private instances: InstanceManager,
    private matches: LiveMatchRegistry,
    private tournaments: LiveTournamentRegistry,
    private presence: PresenceSync,
    private metrics: Metrics,
  ) {}

  server(): ServerDashboard {
    const regions: Record<string, { instances: number; load: number; capacity: number }> = {};
    let totalLoad = 0;
    for (const i of this.instances.alive()) {
      const r = (regions[i.region] ??= { instances: 0, load: 0, capacity: 0 });
      r.instances++; r.load += i.load; r.capacity += i.capacity; totalLoad += i.load;
    }
    return { regions, totalInstances: this.instances.alive().length, totalLoad };
  }

  live(): LiveDashboard {
    return {
      liveMatches: this.matches.count(),
      liveTournaments: this.tournaments.count(),
      onlineUsers: this.presence.online().length,
      byStatus: this.presence.countByStatus(),
    };
  }

  performance(latencyMetric = "route.ticks"): PerformanceDashboard {
    const snap = this.metrics.snapshot();
    return { counters: snap.counters, gauges: snap.gauges, p50: this.metrics.percentile(latencyMetric, 50), p95: this.metrics.percentile(latencyMetric, 95) };
  }
}
