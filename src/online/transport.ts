/**
 * TRANSPORT — abstracción de red con backends INYECTABLES (Online Fase 1/7).
 *
 * Mismo patrón DI que `UpdaterBackend`/`KVAdapter`/`CompetitiveSource` del proyecto: un backend
 * REAL (WebSocket/Supabase Realtime — preparados) y un LOOPBACK en memoria DETERMINISTA para los
 * tests y el juego local/servidor-en-proceso. Soporta dedicado/local/LAN cambiando el backend.
 * El núcleo online habla SOLO con esta interfaz. Reloj LÓGICO (sin wall-clock en el bus).
 */
import type { ConnectionStatus } from "./types";

export type TransportKind = "loopback" | "websocket" | "realtime" | "lan";

/** Un extremo de transporte (cliente). Envía al servidor y recibe del servidor. */
export interface Transport {
  readonly id: string;
  readonly kind: TransportKind;
  status: ConnectionStatus;
  connect(): void;
  close(): void;
  send(raw: string): void;
  onReceive(cb: (raw: string) => void): void;
  onStatus(cb: (s: ConnectionStatus) => void): void;
}

/** Bus del servidor: recibe de cualquier cliente, envía a un cliente concreto. */
export interface ServerBus {
  onReceive(cb: (from: string, raw: string) => void): void;
  send(to: string, raw: string): void;
  close(): void;
}

// ───────────────────────────── Loopback (determinista, en memoria) ─────────────────────────────

interface QueuedMsg { to: string; from: string; raw: string; at: number }

/** Bus en memoria que conecta N clientes con un servidor. Reloj LÓGICO + latencia inyectable. */
export class LoopbackHub {
  now = 0;
  latency: number;
  private rx = new Map<string, (from: string, raw: string) => void>();
  private q: QueuedMsg[] = [];
  private dropped = 0;

  constructor(latency = 0) { this.latency = Math.max(0, latency); }

  register(id: string, cb: (from: string, raw: string) => void): void { this.rx.set(id, cb); }
  unregister(id: string): void { this.rx.delete(id); }
  connected(id: string): boolean { return this.rx.has(id); }

  post(from: string, to: string, raw: string): void { this.q.push({ from, to, raw, at: this.now + this.latency }); }

  /** Entrega los mensajes vencidos (`at <= now`) en orden FIFO. Determinista. */
  pump(): void {
    if (this.q.length === 0) return;
    const due = this.q.filter((m) => m.at <= this.now);
    this.q = this.q.filter((m) => m.at > this.now);
    for (const m of due) {
      const cb = this.rx.get(m.to);
      if (cb) cb(m.from, m.raw); else this.dropped++;
    }
  }

  advance(dt = 1): void { this.now += Math.max(0, dt); }
  pendingCount(): number { return this.q.length; }
  droppedCount(): number { return this.dropped; }
}

/** Transporte de cliente sobre el loopback (peer = "server"). */
export function loopbackClient(hub: LoopbackHub, id: string): Transport {
  let onRx: ((raw: string) => void) | null = null;
  let onSt: ((s: ConnectionStatus) => void) | null = null;
  const t: Transport = {
    id, kind: "loopback", status: "disconnected",
    connect() { hub.register(id, (_from, raw) => onRx?.(raw)); t.status = "connecting"; onSt?.("connecting"); },
    close() { hub.unregister(id); t.status = "closed"; onSt?.("closed"); },
    send(raw) { hub.post(id, "server", raw); },
    onReceive(cb) { onRx = cb; },
    onStatus(cb) { onSt = cb; },
  };
  return t;
}

/** Bus del servidor sobre el loopback. */
export function loopbackServerBus(hub: LoopbackHub): ServerBus {
  return {
    onReceive(cb) { hub.register("server", (from, raw) => cb(from, raw)); },
    send(to, raw) { hub.post("server", to, raw); },
    close() { hub.unregister("server"); },
  };
}

// ───────────────────────────── Backends REALES (preparados) ─────────────────────────────

/**
 * Transporte WebSocket — PREPARADO para fases futuras (servidor dedicado / hosted). La firma es
 * la misma que loopback ⇒ el núcleo online no cambia al enchufar el backend real.
 */
export function websocketTransport(url: string, id: string): Transport {
  let onRx: ((raw: string) => void) | null = null;
  let onSt: ((s: ConnectionStatus) => void) | null = null;
  let ws: WebSocket | null = null;
  const t: Transport = {
    id, kind: "websocket", status: "disconnected",
    connect() {
      t.status = "connecting"; onSt?.("connecting");
      ws = new WebSocket(url);
      ws.onopen = () => { t.status = "connected"; onSt?.("connected"); };
      ws.onmessage = (ev) => onRx?.(String(ev.data));
      ws.onclose = () => { t.status = "closed"; onSt?.("closed"); };
    },
    close() { ws?.close(); ws = null; t.status = "closed"; onSt?.("closed"); },
    send(raw) { if (ws && ws.readyState === 1) ws.send(raw); },
    onReceive(cb) { onRx = cb; },
    onStatus(cb) { onSt = cb; },
  };
  return t;
}

/** Supabase Realtime está en dependencias (hoy sin usar): candidato de backend para Fase 2+. */
export const REALTIME_PREPARED = true;
