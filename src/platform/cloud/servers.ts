/**
 * DEDICATED SERVER / INSTANCE / REGION MANAGER (Online Fase 7/7).
 *
 * Registro de instancias de servidor dedicado por REGIÓN + asignación de partidas a la instancia
 * más cercana y menos cargada (REUTILIZA `selectServer`/`regionPing` del Matchmaking: no reinventa
 * la selección) + heartbeat + estados de instancia. NO crea otro servidor de juego: describe/aloja
 * instancias que corren el ÚNICO Online Core. Determinista (reloj lógico + ids estables).
 */
import { REGIONS, regionPing, selectServer, type ServerNode } from "@/matchmaking";
import type { Region } from "@/domain/cards/types";
import { idFrom, type Instance, type ServerKind, type HealthStatus } from "./types";

/** Tras cuántos ticks sin heartbeat una instancia se considera caída. */
export const HEARTBEAT_TIMEOUT = 30;

export interface AllocateResult { instance: Instance; matchId: string }

export class InstanceManager {
  private instances = new Map<string, Instance>();
  private seq = 0;

  /** Provisiona una instancia (arranque). Idempotente por id. */
  provision(region: Region, kind: ServerKind, capacity: number, now: number): Instance {
    const id = idFrom("inst", region, kind, this.seq++);
    const inst: Instance = {
      id, region, kind, capacity, load: 0, state: "ready", health: "healthy",
      lastBeatAt: now, startedAt: now, matches: [],
    };
    this.instances.set(id, inst);
    return inst;
  }

  /** Aparca (drena) una instancia: no acepta nuevas partidas pero termina las activas. */
  drain(id: string): boolean {
    const i = this.instances.get(id);
    if (!i || i.state === "down") return false;
    i.state = "draining";
    return true;
  }

  /** Marca una instancia como caída (failover la reasigna). */
  markDown(id: string): Instance[] {
    const i = this.instances.get(id);
    if (!i) return [];
    i.state = "down"; i.health = "unhealthy";
    const orphaned = i.matches.slice();
    i.matches = []; i.load = 0;
    return orphaned.map(() => i); // los match ids huérfanos los reubica el ScalingManager
  }

  /** Heartbeat de una instancia viva. */
  heartbeat(id: string, now: number, health: HealthStatus = "healthy"): void {
    const i = this.instances.get(id);
    if (!i || i.state === "down") return;
    i.lastBeatAt = now; i.health = health;
    if (i.state === "provisioning") i.state = "ready";
  }

  /** Detecta instancias sin latido reciente y las marca degradadas/caídas. Devuelve las caídas. */
  sweep(now: number): Instance[] {
    const down: Instance[] = [];
    for (const i of this.instances.values()) {
      if (i.state === "down") continue;
      const age = now - i.lastBeatAt;
      if (age > HEARTBEAT_TIMEOUT) { i.state = "down"; i.health = "unhealthy"; down.push(i); }
      else if (age > HEARTBEAT_TIMEOUT / 2) i.health = "degraded";
    }
    return down;
  }

  /** Vista de las instancias como `ServerNode` (para reutilizar la selección del matchmaking). */
  private nodes(region?: Region): ServerNode[] {
    return [...this.instances.values()]
      .filter((i) => (i.state === "ready" || i.state === "active") && (region ? i.region === region : true))
      .map((i) => ({ id: i.id, kind: i.kind, region: i.region, load: i.load, capacity: i.capacity }));
  }

  /** Asigna una partida a la mejor instancia disponible (más cercana, menos cargada). */
  allocate(matchId: string, region: Region, kind: ServerKind = "dedicated"): AllocateResult | null {
    const pool = this.nodes().filter((n) => n.load < n.capacity && (kind === "cloud" ? true : n.kind === kind || n.kind === "cloud"));
    if (pool.length === 0) return null;
    // REUTILIZA la selección del matchmaking (región → carga → id).
    const node = selectServer("dedicated", region, pool);
    const inst = this.instances.get(node.id)!;
    inst.load++; inst.matches.push(matchId);
    if (inst.state === "ready") inst.state = "active";
    return { instance: inst, matchId };
  }

  /** Libera una partida terminada. */
  release(matchId: string): Instance | null {
    for (const i of this.instances.values()) {
      const idx = i.matches.indexOf(matchId);
      if (idx >= 0) {
        i.matches.splice(idx, 1); i.load = Math.max(0, i.load - 1);
        if (i.load === 0 && i.state === "active") i.state = "ready";
        return i;
      }
    }
    return null;
  }

  get(id: string): Instance | null { return this.instances.get(id) ?? null; }
  all(): Instance[] { return [...this.instances.values()]; }
  alive(): Instance[] { return this.all().filter((i) => i.state !== "down"); }
  byRegion(region: Region): Instance[] { return this.all().filter((i) => i.region === region); }

  /** Capacidad libre total (para autoescalado). */
  freeCapacity(region?: Region): number {
    return this.all()
      .filter((i) => (i.state === "ready" || i.state === "active") && (!region || i.region === region))
      .reduce((a, i) => a + (i.capacity - i.load), 0);
  }
  /** Carga media 0..1 (para autoescalado). */
  loadFactor(region?: Region): number {
    const pool = this.all().filter((i) => i.state !== "down" && (!region || i.region === region));
    const cap = pool.reduce((a, i) => a + i.capacity, 0);
    if (cap === 0) return 1;
    return pool.reduce((a, i) => a + i.load, 0) / cap;
  }
}

/** Region Manager: región óptima por ping para un conjunto de jugadores. Reutiliza `regionPing`. */
export class RegionManager {
  regions(): Region[] { return REGIONS; }
  /** La región con menor ping medio a las regiones de origen dadas. */
  bestRegion(origins: Region[]): Region {
    if (origins.length === 0) return "EMEA";
    let best: Region = origins[0], bestPing = Infinity;
    for (const r of REGIONS) {
      const avg = origins.reduce((a, o) => a + regionPing(o, r), 0) / origins.length;
      if (avg < bestPing) { bestPing = avg; best = r; }
    }
    return best;
  }
  /** Región de failover: la más cercana a la caída que NO sea ella misma. */
  failoverRegion(down: Region): Region {
    return [...REGIONS].filter((r) => r !== down).sort((a, b) => regionPing(down, a) - regionPing(down, b))[0];
  }
}
