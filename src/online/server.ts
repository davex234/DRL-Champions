/**
 * AUTHORITATIVE SERVER — el servidor autoritativo (Online Fase 1/7).
 *
 * Posee el ÚNICO `MatchState` y avanza el sim determinista (reutiliza `createMatch`/`stepMatch`/
 * `tick`). NUNCA confía en el cliente: valida versión, checksum, propiedad del lado y fase antes
 * de aceptar comandos. Emite el input log (lockstep) + snapshots/deltas (observadores). Soporta
 * dedicado/local/LAN según el `ServerBus` inyectado. Reloj LÓGICO. Sin Date.now/Math.random.
 */
import { createMatch, stepMatch, type MatchState, type MatchConfig } from "@/match";
import { tick, type RoundState } from "@/sim";
import type { ServerBus } from "./transport";
import type { Packet, PacketType, TimedCommand, RoundDelta } from "./types";
import { makePacket, decodePacket } from "./packet";
import { PROTOCOL_VERSION, localHandshake, incompatibilityReason, type Handshake } from "./protocol";
import { type Lobby, type LobbyDraft, createLobby, joinLobby, setReady, startLobby } from "./lobby";
import { newHeartbeat, dueForPing, timedOut, onPingSent, onPongReceived, type Heartbeat } from "./heartbeat";
import { applyRoundCommands, matchScalars, snapshotRound, diffRound, newInputLog, appendCommand } from "./replication";
import { ns } from "@/i18n/runtime";

const tr = ns("online");

interface Conn {
  id: string;
  name: string;
  kind: string;
  handshook: boolean;
  authed: boolean;
  side: "home" | "away" | null;
  outSeq: number;
  lastRecvSeq: number;
  hb: Heartbeat;
  reconnectToken: string | null;
  alive: boolean;
}

export interface ServerOptions { lobbyDraft?: LobbyDraft; heartbeatInterval?: number; heartbeatTimeout?: number }

export class OnlineServer {
  now = 0;
  serverTick = 0;
  private bus: ServerBus;
  private conns = new Map<string, Conn>();
  lobby: Lobby | null = null;
  config: MatchConfig | null = null;
  match: MatchState | null = null;
  private roundIdx = 0;
  private prevRound: RoundState | null = null;
  log = newInputLog(0);
  private cmdQueue: { from: string; side: "home" | "away"; kind: "command" | "call"; id: string }[] = [];
  private hbInterval: number;
  private hbTimeout: number;
  private draft: LobbyDraft | null;
  rejected = 0;

  constructor(bus: ServerBus, opts: ServerOptions = {}) {
    this.bus = bus;
    this.hbInterval = opts.heartbeatInterval ?? 30;
    this.hbTimeout = opts.heartbeatTimeout ?? 120;
    this.draft = opts.lobbyDraft ?? null;
    this.bus.onReceive((from, raw) => this.handle(from, raw));
  }

  // ── envío ──
  private send(to: string, type: PacketType, payload: unknown): void {
    const c = this.conns.get(to);
    const seq = c ? (c.outSeq += 1) : 0;
    const ack = c ? c.lastRecvSeq : 0;
    this.bus.send(to, JSON.stringify(makePacket("server", type, seq, ack, this.now, payload)));
  }
  private broadcast(type: PacketType, payload: unknown, filter?: (c: Conn) => boolean): void {
    for (const c of this.conns.values()) if (c.alive && (!filter || filter(c))) this.send(c.id, type, payload);
  }
  private observers(): Conn[] { return [...this.conns.values()].filter((c) => c.kind === "observer" && c.alive); }

  // ── recepción / routing ──
  private handle(from: string, raw: string): void {
    const p = decodePacket(raw);
    if (!p) { this.rejected++; return; }                     // paquete inválido (checksum/protocolo)
    const c = this.conns.get(from);
    if (c) { if (p.seq <= c.lastRecvSeq && p.type !== "hello") { return; } c.lastRecvSeq = Math.max(c.lastRecvSeq, p.seq); }
    switch (p.type) {
      case "hello": return this.onHello(from, p);
      case "auth": return this.onAuth(from, p);
      case "ping": return this.onPing(from, p);
      case "pong": { if (c) c.hb = onPongReceived(c.hb, this.now); return; }
      case "join_lobby": return this.onJoin(from, p);
      case "ready": return this.onReady(from, p);
      case "start": return this.onStart(from);
      case "command": return this.onCommand(from, p);
      case "resync": return this.onResync(from);
      case "leave": return this.onLeave(from);
      default: return;
    }
  }

  private onHello(from: string, p: Packet): void {
    const remote = p.payload as Handshake;
    const local = localHandshake("server", "Servidor");
    const reason = incompatibilityReason(local, remote);
    if (reason) { this.rejected++; this.bus.send(from, JSON.stringify(makePacket("server", "reject", 0, p.seq, this.now, { reason }))); return; }
    const conn: Conn = { id: from, name: remote.name || from, kind: remote.kind || "player", handshook: true, authed: false, side: null, outSeq: 0, lastRecvSeq: p.seq, hb: newHeartbeat(this.hbInterval, this.hbTimeout, this.now), reconnectToken: null, alive: true };
    this.conns.set(from, conn);
    this.send(from, "welcome", { protocol: PROTOCOL_VERSION, serverTick: this.serverTick });
  }
  private onAuth(from: string, p: Packet): void {
    const c = this.conns.get(from); if (!c) return;
    // Capa de auth PREPARADA: aquí se verificaría el JWT (patrón verifyAdmin). Local-first ⇒ acepta.
    c.authed = true;
    c.reconnectToken = (p.payload as { token?: string })?.token ?? `rt-${from}`;
    this.send(from, "auth_ok", { reconnectToken: c.reconnectToken, serverTick: this.serverTick });
  }
  private onPing(from: string, p: Packet): void {
    const clientSent = (p.payload as { t: number })?.t ?? this.now;
    this.send(from, "pong", { clientSent, serverTime: this.now });
  }
  private onJoin(from: string, p: Packet): void {
    const c = this.conns.get(from); if (!c || !c.authed) return;
    // El PRIMER cliente en entrar crea la sala y es el host (autoridad de arranque).
    if (!this.lobby) {
      if (!this.draft) { this.send(from, "error", { reason: tr("Sin configuración de sala.") }); return; }
      this.lobby = createLobby("lobby-1", { id: from, name: c.name, kind: c.kind as "player" | "observer" }, this.draft, 2);
    } else {
      const res = joinLobby(this.lobby, { id: from, name: c.name, kind: c.kind as "player" | "observer" });
      if (res.error) { this.send(from, "error", { reason: res.error }); return; }
      this.lobby = res.lobby;
    }
    c.side = this.lobby.members.find((m) => m.id === from)?.side ?? null;
    this.broadcast("lobby_state", this.lobby);
  }
  private onReady(from: string, p: Packet): void {
    if (!this.lobby) return;
    this.lobby = setReady(this.lobby, from, (p.payload as { ready: boolean })?.ready ?? true);
    this.broadcast("lobby_state", this.lobby);
  }
  private onStart(from: string): void {
    if (!this.lobby || from !== this.lobby.hostId) return;   // solo el host arranca (autoridad)
    const res = startLobby(this.lobby);
    if (!res) { this.send(from, "error", { reason: tr("No se puede arrancar.") }); return; }
    this.lobby = res.lobby;
    this.startMatch(res.config);
  }
  private onCommand(from: string, p: Packet): void {
    const c = this.conns.get(from);
    if (!c || !c.authed || !this.match || this.match.phase !== "ROUND_RUNNING") return;   // fase inválida
    const body = p.payload as { kind: "command" | "call"; id: string; side: "home" | "away" };
    if (!c.side || body.side !== c.side) { this.rejected++; return; }                      // no es su lado (anti-cheat)
    this.cmdQueue.push({ from, side: c.side, kind: body.kind, id: body.id });
  }
  private onResync(from: string): void {
    if (!this.match) return;
    this.send(from, "snapshot", snapshotRound(this.match, this.serverTick));
    if (this.config) this.send(from, "match_state", { config: this.config, log: this.log });
  }
  private onLeave(from: string): void { const c = this.conns.get(from); if (c) c.alive = false; }

  // ── ciclo de partido ──
  startMatch(config: MatchConfig): void {
    this.config = config;
    this.match = createMatch(config);
    this.log = newInputLog(config.seed);
    this.roundIdx = 0;
    this.prevRound = null;
    this.broadcast("match_state", { config, started: true, log: this.log });
  }

  /** Avanza el servidor UN paso lógico: heartbeats + un tick de sim (o una transición de flujo). */
  tick(now: number): void {
    this.now = now;
    // Heartbeats + detección de caídas.
    for (const c of this.conns.values()) {
      if (!c.alive) continue;
      if (dueForPing(c.hb, now)) { c.hb = onPingSent(c.hb, now); this.send(c.id, "ping", { t: now }); }
      if (timedOut(c.hb, now)) { c.alive = false; }
    }
    const m = this.match;
    if (!m) return;
    if (m.phase === "MATCH_END") return;

    if (m.phase === "ROUND_RUNNING" && m.currentRound && m.currentRound.phase !== "ENDED") {
      let r = m.currentRound;
      // Nueva ronda: siembra a los observadores con un snapshot COMPLETO (base para los deltas).
      if (!this.prevRound) {
        const obs = this.observers();
        if (obs.length) { const snap = snapshotRound(m, this.serverTick); for (const c of obs) this.send(c.id, "snapshot", snap); }
        this.prevRound = r;
      }
      // Drena y aplica los comandos encolados EN ESTE tick (determinista + registrado en el log).
      if (this.cmdQueue.length) {
        for (const q of this.cmdQueue) {
          const cmd: TimedCommand = { round: this.roundIdx, tick: r.tick, from: q.from, kind: q.kind, id: q.id, side: q.side };
          const before = r;
          r = applyRoundCommands(r, [cmd]);
          if (r !== before) { this.log = appendCommand(this.log, cmd); this.broadcast("command", cmd, (c) => c.kind !== "observer"); }
        }
        this.cmdQueue = [];
      }
      const next = tick(r);
      this.match = { ...m, currentRound: next };
      this.serverTick++;
      // Delta para observadores (los jugadores hacen lockstep con el log).
      const obs = this.observers();
      if (obs.length) { const d = diffRound(this.prevRound, next, this.serverTick, matchScalars(this.match)); if (d) for (const c of obs) this.send(c.id, "delta", d); }
      this.prevRound = next;
      if (next.phase === "ENDED") { this.match = stepMatch(this.match, () => next); this.roundIdx++; this.prevRound = null; this.broadcast("match_state", { scalars: matchScalars(this.match) }); }
    } else {
      this.match = stepMatch(m);
      this.serverTick++;
      if (this.match.phase === "MATCH_END") this.broadcast("match_state", { scalars: matchScalars(this.match), ended: true });
    }
  }

  connectionCount(): number { return [...this.conns.values()].filter((c) => c.alive).length; }
  isConnected(id: string): boolean { return !!this.conns.get(id)?.alive; }
}

export function createServer(bus: ServerBus, opts?: ServerOptions): OnlineServer { return new OnlineServer(bus, opts); }
