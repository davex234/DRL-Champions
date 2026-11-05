/**
 * SCALING · AUTO-SCALING · LOAD BALANCING · FAILOVER · HA/DR (Online Fase 7/7).
 *
 * Políticas de elasticidad sobre el Instance Manager: autoescalado por carga, balanceo (delega en
 * la asignación del Instance Manager, que reutiliza `selectServer`), failover regional (reubica las
 * partidas huérfanas de una instancia caída), alta disponibilidad (mínimo de instancias por región)
 * y disaster recovery (reprovisión masiva). Determinista (reloj lógico + ids estables). Sin O(n²).
 */
import type { Region } from "@/domain/cards/types";
import { InstanceManager, RegionManager } from "./servers";
import type { ServerKind } from "./types";

export interface ScalingPolicy {
  scaleUpAt: number;    // loadFactor por encima del cual se provisiona (0..1)
  scaleDownAt: number;  // por debajo del cual se drena una instancia vacía
  minPerRegion: number; // HA: instancias mínimas vivas por región
  capacity: number;     // capacidad de cada instancia nueva
  kind: ServerKind;
}

export const DEFAULT_POLICY: ScalingPolicy = { scaleUpAt: 0.8, scaleDownAt: 0.2, minPerRegion: 1, capacity: 50, kind: "dedicated" };

export interface ScaleEvent { kind: "up" | "down" | "failover" | "ha_fill"; region: Region; instanceId: string; at: number }

export class ScalingManager {
  private events: ScaleEvent[] = [];
  constructor(
    private instances: InstanceManager,
    private regions = new RegionManager(),
    private policy: ScalingPolicy = DEFAULT_POLICY,
  ) {}

  /** Alta disponibilidad: garantiza `minPerRegion` instancias vivas por región. */
  ensureHA(now: number): ScaleEvent[] {
    const out: ScaleEvent[] = [];
    for (const r of this.regions.regions()) {
      const alive = this.instances.byRegion(r).filter((i) => i.state !== "down").length;
      for (let k = alive; k < this.policy.minPerRegion; k++) {
        const inst = this.instances.provision(r, this.policy.kind, this.policy.capacity, now);
        this.instances.heartbeat(inst.id, now);
        out.push(this.rec({ kind: "ha_fill", region: r, instanceId: inst.id, at: now }));
      }
    }
    return out;
  }

  /** Autoescalado por carga (por región). Provisiona si va saturada, drena una vacía si sobra. */
  autoscale(now: number): ScaleEvent[] {
    const out: ScaleEvent[] = [];
    for (const r of this.regions.regions()) {
      const lf = this.instances.loadFactor(r);
      const regionInstances = this.instances.byRegion(r).filter((i) => i.state !== "down");
      if (lf >= this.policy.scaleUpAt) {
        const inst = this.instances.provision(r, this.policy.kind, this.policy.capacity, now);
        this.instances.heartbeat(inst.id, now);
        out.push(this.rec({ kind: "up", region: r, instanceId: inst.id, at: now }));
      } else if (lf <= this.policy.scaleDownAt && regionInstances.length > this.policy.minPerRegion) {
        const empty = regionInstances.find((i) => i.load === 0 && i.state === "ready");
        if (empty) { this.instances.drain(empty.id); this.instances.markDown(empty.id); out.push(this.rec({ kind: "down", region: r, instanceId: empty.id, at: now })); }
      }
    }
    return out;
  }

  /** Balanceo: asigna una partida a la mejor instancia (región óptima). Devuelve la instancia. */
  distribute(matchId: string, region: Region, now: number): string | null {
    let alloc = this.instances.allocate(matchId, region, this.policy.kind);
    if (!alloc) {
      // sin capacidad: escala y reintenta una vez (backpressure controlado)
      const inst = this.instances.provision(region, this.policy.kind, this.policy.capacity, now);
      this.instances.heartbeat(inst.id, now);
      this.rec({ kind: "up", region, instanceId: inst.id, at: now });
      alloc = this.instances.allocate(matchId, region, this.policy.kind);
    }
    return alloc?.instance.id ?? null;
  }

  /**
   * Failover regional: reubica las partidas huérfanas de una instancia caída en otra instancia
   * (misma región si hay hueco; si no, la región de failover más cercana). Reasigna cada match id.
   */
  failover(downInstanceId: string, orphanMatchIds: string[], now: number): { moved: Record<string, string>; lost: string[] } {
    const down = this.instances.get(downInstanceId);
    const homeRegion = down?.region ?? "EMEA";
    const moved: Record<string, string> = {};
    const lost: string[] = [];
    for (const mid of orphanMatchIds) {
      let alloc = this.instances.allocate(mid, homeRegion, this.policy.kind);
      if (!alloc) {
        const fr = this.regions.failoverRegion(homeRegion);
        // asegura capacidad en la región de failover
        const inst = this.instances.provision(fr, this.policy.kind, this.policy.capacity, now);
        this.instances.heartbeat(inst.id, now);
        this.rec({ kind: "failover", region: fr, instanceId: inst.id, at: now });
        alloc = this.instances.allocate(mid, fr, this.policy.kind);
      }
      if (alloc) moved[mid] = alloc.instance.id; else lost.push(mid);
    }
    return { moved, lost };
  }

  /** Disaster recovery: tras una caída masiva, reprovisiona hasta cumplir HA en todas las regiones. */
  disasterRecovery(now: number): ScaleEvent[] { return this.ensureHA(now); }

  private rec(e: ScaleEvent): ScaleEvent { this.events.push(e); return e; }
  eventLog(): ScaleEvent[] { return this.events.slice(); }
}
