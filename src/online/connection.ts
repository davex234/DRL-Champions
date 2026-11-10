/**
 * CONNECTION MANAGER — máquina de estados observable del cliente (Online Fase 1/7).
 *
 * Gestiona transporte + handshake + versionado + heartbeat + latencia + reloj + reconexión y
 * expone un `NetworkState` observable (patrón `UpdateController` del proyecto). Reenvía los
 * paquetes de juego (lobby/match/replicación) a la capa cliente. Reloj LÓGICO (sin wall-clock).
 */
import type { Transport } from "./transport";
import type { ClientIdentity, NetworkState, Packet, PacketType } from "./types";
import { makePacket, decodePacket } from "./packet";
import { PROTOCOL_VERSION, localHandshake } from "./protocol";
import { NetEventBus } from "./events";
import { estimateClock, type ClockSample, type NetClock } from "./clock";
import { newLatency, recordRtt, type LatencyMonitor } from "./latency";

export class ConnectionManager {
  now = 0;
  state: NetworkState;
  readonly identity: ClientIdentity;
  private transport: Transport;
  private bus = new NetEventBus();
  private onGame: ((p: Packet) => void) | null = null;
  private outSeq = 0;
  private lastRecvSeq = 0;
  private clock: NetClock = { offset: 0, rtt: 0, samples: 0 };
  private samples: ClockSample[] = [];
  private latency: LatencyMonitor = newLatency();
  private reconnectToken: string | null = null;
  private pingEvery = 25;
  private lastPingAt = 0;

  constructor(transport: Transport, identity: ClientIdentity) {
    this.transport = transport;
    this.identity = identity;
    this.state = { status: "disconnected", protocol: PROTOCOL_VERSION, rtt: 0, jitter: 0, reconnects: 0, since: 0, clockOffset: 0, serverTick: 0 };
    this.transport.onReceive((raw) => this.recv(raw));
  }

  subscribe(cb: Parameters<NetEventBus["subscribe"]>[0]): () => void { return this.bus.subscribe(cb); }
  onGamePacket(cb: (p: Packet) => void): void { this.onGame = cb; }
  getState(): NetworkState { return this.state; }
  clockOffset(): number { return this.clock.offset; }

  private patch(s: Partial<NetworkState>): void { this.state = { ...this.state, ...s, since: this.now }; }

  connect(now: number): void {
    this.now = now;
    this.transport.connect();
    this.patch({ status: "handshaking" });
    this.send("hello", localHandshake(this.identity.kind, this.identity.name));
  }

  /** Reconexión: reabre el transporte y pide un resync autoritativo. */
  reconnect(now: number): void {
    this.now = now;
    this.patch({ status: "reconnecting", reconnects: this.state.reconnects + 1 });
    this.transport.connect();
    this.send("hello", localHandshake(this.identity.kind, this.identity.name));
  }

  close(now: number): void { this.now = now; this.send("leave", {}); this.transport.close(); this.patch({ status: "closed" }); }

  send(type: PacketType, payload: unknown): void {
    const seq = (this.outSeq += 1);
    this.transport.send(JSON.stringify(makePacket(this.identity.id, type, seq, this.lastRecvSeq, this.now, payload)));
  }

  private recv(raw: string): void {
    const p = decodePacket(raw);
    if (!p) return;                                   // paquete inválido descartado
    if (p.seq > 0) this.lastRecvSeq = Math.max(this.lastRecvSeq, p.seq);
    switch (p.type) {
      case "welcome": { this.patch({ status: "authenticating", serverTick: (p.payload as { serverTick: number }).serverTick }); this.send("auth", { token: this.identity.token }); return; }
      case "auth_ok": { this.reconnectToken = (p.payload as { reconnectToken: string }).reconnectToken; const first = this.state.status !== "connected"; this.patch({ status: "connected" }); this.bus.emit(this.state.reconnects > 0 && !first ? "reconnected" : "connected", this.now); if (this.state.reconnects > 0) this.send("resync", {}); return; }
      case "reject": { this.patch({ status: "closed" }); this.bus.emit("error", this.now, p.payload); return; }
      case "ping": { this.send("pong", { echo: (p.payload as { t: number }).t }); return; }
      case "pong": { this.onPong(p); return; }
      default: this.onGame?.(p); return;
    }
  }

  private onPong(p: Packet): void {
    const { clientSent, serverTime } = p.payload as { clientSent: number; serverTime: number };
    this.samples = [...this.samples, { clientSent, serverTime, clientRecv: this.now }].slice(-16);
    this.clock = estimateClock(this.samples);
    this.latency = recordRtt(this.latency, this.now - clientSent);
    this.patch({ rtt: this.latency.rtt, jitter: this.latency.jitter, clockOffset: this.clock.offset });
    this.bus.emit("latency", this.now, { rtt: this.latency.rtt, jitter: this.latency.jitter });
  }

  /** Bombea heartbeat/clock del cliente. Llamar cada tick lógico. */
  tick(now: number): void {
    this.now = now;
    if (this.state.status === "connected" && now - this.lastPingAt >= this.pingEvery) { this.lastPingAt = now; this.send("ping", { t: now }); }
  }
}
