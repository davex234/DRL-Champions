/**
 * LIVE REGISTRIES · PRESENCE SYNC (Online Fase 7/7).
 *
 * Índices en vivo de lo que está OCURRIENDO en la plataforma: partidas activas y torneos activos
 * (para spectator/dashboard/streaming) + sincronización de presencia distribuida. NO duplica el
 * Match/Tournament: solo referencia sus ids + un resumen. Determinista, O(1) por alta/baja.
 */
import type { Region } from "@/domain/cards/types";

export interface LiveMatch {
  matchId: string;
  instanceId: string;
  region: Region;
  mode: string;
  teams: { home: string; away: string };
  spectators: number;
  startedAt: number;
  score: { home: number; away: number };
  finished: boolean;
}

export interface LiveTournament {
  tournamentId: string;
  name: string;
  region: Region;
  liveFixtures: string[];
  startedAt: number;
  finished: boolean;
}

export type PresenceStatus = "online" | "in_queue" | "in_match" | "spectating" | "away" | "offline";
export interface Presence { userId: string; status: PresenceStatus; region: Region; matchId: string | null; at: number }

export class LiveMatchRegistry {
  private m = new Map<string, LiveMatch>();
  open(lm: LiveMatch): void { this.m.set(lm.matchId, lm); }
  update(id: string, patch: Partial<LiveMatch>): void { const x = this.m.get(id); if (x) Object.assign(x, patch); }
  addSpectator(id: string, n = 1): void { const x = this.m.get(id); if (x) x.spectators = Math.max(0, x.spectators + n); }
  finish(id: string): void { const x = this.m.get(id); if (x) x.finished = true; }
  close(id: string): void { this.m.delete(id); }
  get(id: string): LiveMatch | null { return this.m.get(id) ?? null; }
  live(): LiveMatch[] { return [...this.m.values()].filter((x) => !x.finished); }
  all(): LiveMatch[] { return [...this.m.values()]; }
  byRegion(r: Region): LiveMatch[] { return this.live().filter((x) => x.region === r); }
  count(): number { return this.live().length; }
}

export class LiveTournamentRegistry {
  private t = new Map<string, LiveTournament>();
  open(lt: LiveTournament): void { this.t.set(lt.tournamentId, lt); }
  setFixtures(id: string, fixtures: string[]): void { const x = this.t.get(id); if (x) x.liveFixtures = fixtures; }
  finish(id: string): void { const x = this.t.get(id); if (x) { x.finished = true; x.liveFixtures = []; } }
  get(id: string): LiveTournament | null { return this.t.get(id) ?? null; }
  live(): LiveTournament[] { return [...this.t.values()].filter((x) => !x.finished); }
  count(): number { return this.live().length; }
}

/** Presence Sync: última presencia conocida por usuario (distribuida = merge por reloj lógico). */
export class PresenceSync {
  private p = new Map<string, Presence>();
  /** Actualiza si el evento es MÁS reciente (LWW por reloj lógico). */
  sync(pr: Presence): void {
    const cur = this.p.get(pr.userId);
    if (!cur || pr.at >= cur.at) this.p.set(pr.userId, pr);
  }
  get(userId: string): Presence | null { return this.p.get(userId) ?? null; }
  online(): Presence[] { return [...this.p.values()].filter((x) => x.status !== "offline"); }
  countByStatus(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const x of this.p.values()) out[x.status] = (out[x.status] ?? 0) + 1;
    return out;
  }
}
