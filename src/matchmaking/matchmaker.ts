/**
 * MATCHMAKER — el orquestador del ÚNICO flujo (Online Fase 2/7).
 *
 *   Player → Queue → Search → Match Builder → Lobby → Session → Server → Gameplay
 *
 * Compone queue + search + balance + servidor + ready check + bot fill y, al confirmarse una
 * partida, entrega un `LobbyDraft` del Online Core vía `onMatchReady` (que lanza `createLocalGame`
 * o el transporte real). Búsqueda BUCKETED (sin O(n²)). DETERMINISTA (reloj lógico). Seguridad:
 * anti doble-cola, timeouts, cancelación, sin lobbies/sesiones huérfanas.
 */
import type { LobbyDraft } from "@/online";
import type {
  QueueMode, PlayerProfile, QueueTicket, MatchProposal, ServerNode,
  QueueSnapshot, QueueMetrics, MatchmakingEvent, MatchmakingEventType, Region,
} from "./types";
import { PVP_MODES, INSTANT_MODES } from "./types";
import { Queue } from "./queue";
import { DEFAULT_SEARCH, expandWindow, type SearchConfig } from "./search";
import { acceptable } from "./balance";
import { defaultNodes } from "./server";
import { buildProposal, toLobbyDraft, type RosterProvider, defaultRosterProvider } from "./matchBuilder";
import { accept as rcAccept, decline as rcDecline, tickReady, isReady, isFailed } from "./readycheck";
import { isBot } from "./botfill";

export interface MatchmakerConfig {
  search: SearchConfig;
  nodes: ServerNode[];
  readyTimeout: number;   // ticks para aceptar
  seedBase: number;
  rosterProvider: RosterProvider;
}

export function defaultMatchmakerConfig(seedBase = 1): MatchmakerConfig {
  return { search: DEFAULT_SEARCH, nodes: defaultNodes(), readyTimeout: 40, seedBase, rosterProvider: defaultRosterProvider };
}

export class Matchmaker {
  now = 0;
  private queues = new Map<QueueMode, Queue>();
  private membership = new Map<string, string>();  // playerId → ticketId (anti doble-cola)
  private ticketsById = new Map<string, QueueTicket>();
  private proposals = new Map<string, MatchProposal>();
  private cfg: MatchmakerConfig;
  private ticketCounter = 0;
  private propCounter = 0;
  private waitAccum = 0; private waitCount = 0;
  metrics: QueueMetrics = { enqueued: 0, matched: 0, cancelled: 0, expired: 0, declined: 0, searches: 0, avgWaitTicks: 0 };
  events: MatchmakingEvent[] = [];
  onMatchReady?: (proposal: MatchProposal, draft: LobbyDraft) => void;

  constructor(cfg: Partial<MatchmakerConfig> = {}) { this.cfg = { ...defaultMatchmakerConfig(), ...cfg }; }

  private emit(type: MatchmakingEventType, data?: unknown): void { this.events.push({ type, at: this.now, data }); }
  private queue(mode: QueueMode): Queue { let q = this.queues.get(mode); if (!q) { q = new Queue(mode); this.queues.set(mode, q); } return q; }

  // ── Cola ──
  enqueue(profile: PlayerProfile, mode: QueueMode, opts: { priority?: number } = {}): { ticket?: QueueTicket; error?: string } {
    if (this.membership.has(profile.id)) return { error: "already-queued" };   // SEGURIDAD: no doble cola
    const id = `tk-${this.cfg.seedBase}-${this.ticketCounter++}`;
    const ticket: QueueTicket = { id, profile, mode, region: profile.region, enqueuedAt: this.now, priority: opts.priority ?? 0, state: "searching", proposalId: null, serverPref: null, retries: 0 };
    this.queue(mode).add(ticket); this.ticketsById.set(id, ticket); this.membership.set(profile.id, id);
    this.metrics.enqueued++; this.emit("enqueued", { id, mode });
    if (INSTANT_MODES.includes(mode)) this.makeInstant(ticket);   // practice/ai/offline: partida inmediata vs bots
    return { ticket };
  }

  cancel(ticketId: string): boolean {
    const t = this.ticketsById.get(ticketId); if (!t) return false;
    if (t.proposalId) { const p = this.proposals.get(t.proposalId); if (p) this.failProposal(p, ticketId); }
    this.removeTicket(t, "cancelled"); this.metrics.cancelled++; this.emit("cancelled", { id: ticketId });
    return true;
  }

  accept(ticketId: string): void { const t = this.ticketsById.get(ticketId); if (!t?.proposalId) return; const p = this.proposals.get(t.proposalId); if (p) { p.readyCheck = rcAccept(p.readyCheck, ticketId); this.emit("accepted", { id: ticketId }); } }
  decline(ticketId: string): void { const t = this.ticketsById.get(ticketId); if (!t?.proposalId) return; const p = this.proposals.get(t.proposalId); if (p) { p.readyCheck = rcDecline(p.readyCheck, ticketId); this.emit("declined", { id: ticketId }); } }

  // ── Bucle ──
  tick(now: number): void {
    this.now = now;
    for (const p of [...this.proposals.values()]) {
      p.readyCheck = tickReady(p.readyCheck, now);
      if (isReady(p.readyCheck)) this.finalize(p);
      else if (isFailed(p.readyCheck)) this.failProposal(p, null);
    }
    for (const mode of PVP_MODES) if (this.queues.has(mode)) this.searchPass(mode);
    this.metrics.avgWaitTicks = this.waitCount ? Math.round(this.waitAccum / this.waitCount) : 0;
  }

  /** Pasada de búsqueda BUCKETED por región + MMR (sin O(n²)). */
  private searchPass(mode: QueueMode): void {
    const waiting = this.queue(mode).waiting();
    if (waiting.length < 2) return;
    this.metrics.searches++;
    const buckets = new Map<Region, QueueTicket[]>();
    for (const t of waiting) { const arr = buckets.get(t.region) ?? []; arr.push(t); buckets.set(t.region, arr); }
    const leftovers: QueueTicket[] = [];
    for (const [, list] of buckets) {
      list.sort((a, b) => a.profile.mmr - b.profile.mmr || b.enqueuedAt - a.enqueuedAt || (a.id < b.id ? -1 : 1));
      const used = new Set<string>();
      for (let i = 0; i < list.length; i++) {
        const a = list[i]; if (used.has(a.id) || a.state !== "searching") continue;
        let paired = false;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j]; if (used.has(b.id) || b.state !== "searching") continue;
          const waitA = this.now - a.enqueuedAt, waitB = this.now - b.enqueuedAt;
          const win = expandWindow(this.cfg.search, Math.max(waitA, waitB));
          if (b.profile.mmr - a.profile.mmr > win.mmrRange) break;             // ordenado ⇒ corta (evita O(n²))
          if (acceptable(a.profile, b.profile, win, waitA, waitB)) { this.createProposal(mode, a, b); used.add(a.id); used.add(b.id); paired = true; break; }
        }
        if (!paired) leftovers.push(a);
      }
    }
    // Fallback CROSS-REGIÓN para quienes esperan mucho (relajación de región).
    const long = leftovers.filter((t) => t.state === "searching" && this.now - t.enqueuedAt >= this.cfg.search.relaxRegionAfter)
      .sort((a, b) => a.profile.mmr - b.profile.mmr || (a.id < b.id ? -1 : 1));
    const used = new Set<string>();
    for (let i = 0; i + 1 < long.length; i++) {
      const a = long[i]; if (used.has(a.id) || a.state !== "searching") continue;
      const b = long[i + 1]; if (used.has(b.id) || b.state !== "searching") continue;
      const win = expandWindow(this.cfg.search, Math.max(this.now - a.enqueuedAt, this.now - b.enqueuedAt));
      if (acceptable(a.profile, b.profile, win, this.now - a.enqueuedAt, this.now - b.enqueuedAt)) { this.createProposal(mode, a, b); used.add(a.id); used.add(b.id); }
    }
  }

  private createProposal(mode: QueueMode, a: QueueTicket, b: QueueTicket): void {
    a.state = "proposed"; b.state = "proposed";
    const id = `prop-${this.cfg.seedBase}-${this.propCounter++}`;
    const p = buildProposal(mode, [a], [b], this.cfg.nodes, this.now, this.cfg.seedBase, id, this.cfg.readyTimeout, true);
    a.proposalId = id; b.proposalId = id; this.proposals.set(id, p);
    this.emit("proposed", { id }); this.emit("ready_check", { id, needed: p.readyCheck.needed });
  }

  private makeInstant(ticket: QueueTicket): void {
    ticket.state = "proposed";
    const id = `prop-${this.cfg.seedBase}-${this.propCounter++}`;
    const p = buildProposal(ticket.mode, [ticket], [], this.cfg.nodes, this.now, this.cfg.seedBase, id, this.cfg.readyTimeout, false);
    ticket.proposalId = id; this.proposals.set(id, p); this.emit("proposed", { id });
  }

  private finalize(p: MatchProposal): void {
    if (this.onMatchReady) this.onMatchReady(p, toLobbyDraft(p, this.ticketsById, this.cfg.rosterProvider));
    for (const id of [...p.teamHome, ...p.teamAway]) { const t = this.ticketsById.get(id); if (t) { t.state = "matched"; this.recordWait(t); this.removeTicket(t, "matched"); } }
    this.proposals.delete(p.id);
    this.metrics.matched++; this.emit("matched", { id: p.id }); this.emit("launched", { id: p.id, server: p.server.id });
  }

  private failProposal(p: MatchProposal, decliner: string | null): void {
    for (const id of [...p.teamHome, ...p.teamAway]) {
      const t = this.ticketsById.get(id); if (!t) continue;
      const declined = p.readyCheck.declined.includes(id) || id === decliner;
      if (declined) { this.removeTicket(t, "cancelled"); this.metrics.declined++; }
      else { t.state = "searching"; t.proposalId = null; t.retries++; this.emit("requeued", { id }); }   // AUTO-RETRY / reconnect queue
    }
    if (isFailed(p.readyCheck) && p.readyCheck.declined.length === 0) this.metrics.expired++;
    this.proposals.delete(p.id);
  }

  /** BACKFILL: sustituye a un ticket que se cae por un bot ANTES del lanzamiento. */
  backfill(proposalId: string, ticketId: string): boolean {
    const p = this.proposals.get(proposalId); if (!p) return false;
    const arr = p.teamHome.includes(ticketId) ? p.teamHome : p.teamAway.includes(ticketId) ? p.teamAway : null;
    if (!arr) return false;
    arr.splice(arr.indexOf(ticketId), 1);
    if (p.teamHome === arr) p.botsHome++; else p.botsAway++;
    const needed = p.readyCheck.needed.filter((n) => n !== ticketId);
    p.readyCheck = { ...p.readyCheck, needed, status: p.readyCheck.accepted.length >= needed.length ? "ready" : "pending" };
    const t = this.ticketsById.get(ticketId); if (t) this.removeTicket(t, "cancelled");
    this.emit("backfilled", { proposalId, ticketId }); return true;
  }

  private removeTicket(t: QueueTicket, state: QueueTicket["state"]): void {
    t.state = state;
    this.queue(t.mode).remove(t.id);
    this.membership.delete(t.profile.id);
    this.ticketsById.delete(t.id);
  }
  private recordWait(t: QueueTicket): void { this.waitAccum += this.now - t.enqueuedAt; this.waitCount++; }

  // ── Lectura ──
  snapshot(mode: QueueMode): QueueSnapshot { return this.queue(mode).snapshot(this.now); }
  ticket(id: string): QueueTicket | undefined { return this.ticketsById.get(id); }
  proposal(id: string): MatchProposal | undefined { return this.proposals.get(id); }
  isQueued(playerId: string): boolean { return this.membership.has(playerId); }
  queuedCount(): number { return this.membership.size; }
  proposalCount(): number { return this.proposals.size; }
}
