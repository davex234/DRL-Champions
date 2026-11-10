/**
 * EVENT QUEUE + NETWORK EVENTS — mensajería ordenada/fiable y bus de eventos (Online Fase 1/7).
 *
 * `OutboundQueue`: numeración de secuencia + reenvío pendiente (fiabilidad, preparada para acks).
 * `InboundOrder`: dedupe/orden por secuencia. `NetEventBus`: notifica eventos de red a la UI.
 * PURO (salvo el bus, que es un emisor sin efectos temporales). Determinista.
 */
import type { NetworkEvent } from "./types";

// ── Salida: secuencia + no-confirmados (reliability preparada) ──
export interface OutboundQueue { seq: number; unacked: { seq: number; raw: string }[] }
export function newOutbound(): OutboundQueue { return { seq: 0, unacked: [] }; }

export function enqueueOut(q: OutboundQueue, raw: string): { queue: OutboundQueue; seq: number } {
  const seq = q.seq + 1;
  return { queue: { seq, unacked: [...q.unacked, { seq, raw }] }, seq };
}
/** Descarta lo confirmado hasta `ack` (incluido). */
export function ackUpTo(q: OutboundQueue, ack: number): OutboundQueue {
  return { ...q, unacked: q.unacked.filter((u) => u.seq > ack) };
}

// ── Entrada: orden/dedupe ──
export interface InboundOrder { lastSeq: number }
export function newInbound(): InboundOrder { return { lastSeq: 0 }; }
/** Acepta un seq solo si es nuevo (mayor que el último). Descarta duplicados/atrasados. */
export function acceptSeq(o: InboundOrder, seq: number): { order: InboundOrder; isNew: boolean } {
  if (seq > o.lastSeq) return { order: { lastSeq: seq }, isNew: true };
  return { order: o, isNew: false };
}

// ── Bus de eventos de red (para la UI) ──
export class NetEventBus {
  private subs: ((e: NetworkEvent) => void)[] = [];
  subscribe(cb: (e: NetworkEvent) => void): () => void {
    this.subs.push(cb);
    return () => { this.subs = this.subs.filter((s) => s !== cb); };
  }
  emit(type: NetworkEvent["type"], at: number, data?: unknown): void {
    const e: NetworkEvent = { type, at, data };
    for (const s of this.subs) s(e);
  }
}
