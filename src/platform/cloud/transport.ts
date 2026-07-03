/**
 * REALTIME TRANSPORT LAYER — adapters de transporte con DI (Online Fase 7/7).
 *
 * NO crea otro transporte: envuelve el `Transport`/`ServerBus` del ÚNICO Online Core en una capa de
 * ADAPTERS conmutables (loopback/websocket/realtime/lan/offline/cloud). El loopback es DETERMINISTA
 * (reutiliza `LoopbackHub`) y sirve para tests / servidor-en-proceso; websocket y realtime están
 * PREPARADOS (reutilizan `websocketTransport`/`REALTIME_PREPARED`) para producción. El núcleo online
 * habla SOLO con la interfaz `Transport`, así que enchufar el backend real no cambia el juego.
 */
import {
  LoopbackHub, loopbackClient, loopbackServerBus, websocketTransport, REALTIME_PREPARED,
  type Transport, type ServerBus,
} from "@/online";
import type { PlatformTransportKind } from "./types";

/** Un backend de transporte: fabrica buses de servidor y transportes de cliente. */
export interface TransportAdapter {
  readonly kind: PlatformTransportKind;
  /** ¿Está operativo AQUÍ (entorno/servidor real disponible)? */
  readonly available: boolean;
  /** ¿Es determinista / en-proceso (para tests y single-player)? */
  readonly deterministic: boolean;
  serverBus(): ServerBus;
  clientTransport(id: string): Transport;
  /** Avanza el reloj lógico y entrega mensajes (solo backends en-proceso). */
  pump?(): void;
  advance?(dt?: number): void;
}

// ───────────────────────────── Loopback (determinista) ─────────────────────────────

/** Adapter loopback: reutiliza el hub en memoria del Online Core. Un hub por instancia lógica. */
export class LoopbackAdapter implements TransportAdapter {
  readonly kind: PlatformTransportKind = "loopback";
  readonly available = true;
  readonly deterministic = true;
  readonly hub: LoopbackHub;
  constructor(latency = 0) { this.hub = new LoopbackHub(latency); }
  serverBus(): ServerBus { return loopbackServerBus(this.hub); }
  clientTransport(id: string): Transport { return loopbackClient(this.hub, id); }
  pump(): void { this.hub.pump(); }
  advance(dt = 1): void { this.hub.advance(dt); }
}

/** LAN = loopback sobre red local (mismo backend en-proceso; se marca como `lan`). */
export class LanAdapter extends LoopbackAdapter {
  readonly kind: PlatformTransportKind = "lan";
}

/** Offline = loopback de un solo proceso (single-player/práctica). */
export class OfflineAdapter extends LoopbackAdapter {
  readonly kind: PlatformTransportKind = "offline";
  readonly deterministic = true;
}

// ───────────────────────────── Backends REALES (preparados) ─────────────────────────────

/** WebSocket dedicado — PREPARADO (reutiliza `websocketTransport`); requiere entorno con `WebSocket`. */
export class WebSocketAdapter implements TransportAdapter {
  readonly kind: PlatformTransportKind = "websocket";
  readonly deterministic = false;
  constructor(private url: string) {}
  get available(): boolean { return typeof WebSocket !== "undefined"; }
  serverBus(): ServerBus { throw new Error("WebSocketAdapter: el bus de servidor vive en el servidor dedicado (no en-proceso)"); }
  clientTransport(id: string): Transport { return websocketTransport(this.url, id); }
}

/** Supabase Realtime — PREPARADO (`REALTIME_PREPARED`); mismo contrato `Transport`, aún sin cablear. */
export class RealtimeAdapter implements TransportAdapter {
  readonly kind: PlatformTransportKind = "realtime";
  readonly deterministic = false;
  readonly prepared = REALTIME_PREPARED;
  constructor(private channel: string) {}
  get available(): boolean { return false; } // se activa al cablear el cliente Realtime en producción
  serverBus(): ServerBus { throw new Error("RealtimeAdapter: preparado, aún no cableado"); }
  clientTransport(id: string): Transport { return websocketTransport(`realtime://${this.channel}/${id}`, id); }
}

/** Cloud (hosted, autoescalado) — PREPARADO; delega en el WebSocket dedicado del proveedor. */
export class CloudAdapter extends WebSocketAdapter {
  readonly kind: PlatformTransportKind = "cloud";
}

// ───────────────────────────── Registro de transportes ─────────────────────────────

/** Selecciona el adapter por tipo; cae a loopback determinista si el real no está disponible. */
export class TransportRegistry {
  private adapters = new Map<PlatformTransportKind, TransportAdapter>();
  constructor() {
    this.register(new LoopbackAdapter());
    this.register(new LanAdapter());
    this.register(new OfflineAdapter());
  }
  register(a: TransportAdapter): void { this.adapters.set(a.kind, a); }
  get(kind: PlatformTransportKind): TransportAdapter | null { return this.adapters.get(kind) ?? null; }
  /** Resuelve un adapter USABLE: el pedido si está disponible, si no el loopback determinista. */
  resolve(kind: PlatformTransportKind): TransportAdapter {
    const a = this.adapters.get(kind);
    if (a && a.available) return a;
    return this.adapters.get("loopback")!;
  }
  kinds(): PlatformTransportKind[] { return [...this.adapters.keys()]; }
}
