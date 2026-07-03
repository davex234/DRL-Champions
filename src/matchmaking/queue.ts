/**
 * QUEUE ENGINE — la cola por modo (Online Fase 2/7).
 *
 * Almacena tickets y produce snapshots (población, salud, espera estimada). El emparejamiento
 * BUCKETED lo hace el Matchmaker (sin O(n²)). PURO respecto al reloj (el `now` se inyecta).
 */
import type { QueueMode, QueueTicket, QueueSnapshot } from "./types";
import { estimatedWait, queueHealth } from "./search";

export class Queue {
  readonly mode: QueueMode;
  private tickets = new Map<string, QueueTicket>();
  constructor(mode: QueueMode) { this.mode = mode; }

  add(t: QueueTicket): void { this.tickets.set(t.id, t); }
  remove(id: string): QueueTicket | null { const t = this.tickets.get(id) ?? null; this.tickets.delete(id); return t; }
  get(id: string): QueueTicket | undefined { return this.tickets.get(id); }
  all(): QueueTicket[] { return [...this.tickets.values()]; }
  waiting(): QueueTicket[] { return this.all().filter((t) => t.state === "searching"); }
  size(): number { return this.tickets.size; }

  snapshot(now: number): QueueSnapshot {
    const w = this.waiting();
    const byRegion: Record<string, number> = {};
    for (const t of w) byRegion[t.region] = (byRegion[t.region] ?? 0) + 1;
    const oldestWait = w.length ? Math.max(...w.map((t) => now - t.enqueuedAt)) : 0;
    return { mode: this.mode, size: w.length, byRegion, oldestWait, estimatedWait: estimatedWait(w.length), health: queueHealth(w.length, oldestWait) };
  }
}
