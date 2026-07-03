/**
 * PLATFORM EVENT BUS · WEBHOOKS · STREAMING HOOKS (Online Fase 7/7).
 *
 * Un único bus de eventos de plataforma al que se suscriben SINKS: webhooks HTTP (preparados),
 * OBS/Broadcast (reutiliza la Presentation existente vía datos), Discord (preparado). Los sinks son
 * DI: en tests capturan en memoria (determinista); en producción hacen fetch/websocket. Filtro por
 * tipo de evento. Sin acoplar la plataforma a ningún proveedor concreto.
 */
import type { PlatformEvent, PlatformEventType } from "./types";

/** Un consumidor de eventos de plataforma. */
export interface WebhookSink {
  readonly name: string;
  readonly events: PlatformEventType[] | "*";
  deliver(ev: PlatformEvent): void;
}

/** Sink en memoria (tests / auditoría local). Determinista. */
export class MemorySink implements WebhookSink {
  readonly name: string;
  readonly events: PlatformEventType[] | "*";
  readonly received: PlatformEvent[] = [];
  constructor(name = "memory", events: PlatformEventType[] | "*" = "*") { this.name = name; this.events = events; }
  deliver(ev: PlatformEvent): void { this.received.push(ev); }
  countOf(type: PlatformEventType): number { return this.received.filter((e) => e.type === type).length; }
}

/** Webhook HTTP genérico (PREPARADO): en producción hace POST; aquí registra la intención. */
export class HttpWebhook implements WebhookSink {
  readonly name = "http";
  readonly outbox: { url: string; body: string }[] = [];
  constructor(private url: string, readonly events: PlatformEventType[] | "*" = "*") {}
  deliver(ev: PlatformEvent): void { this.outbox.push({ url: this.url, body: JSON.stringify(ev) }); }
}

/** Streaming / OBS hook: transforma eventos en cues de escena (reutiliza los datos de Presentation). */
export interface StreamCue { scene: string; at: number; payload: unknown }
export class StreamingHook implements WebhookSink {
  readonly name = "streaming";
  readonly cues: StreamCue[] = [];
  readonly events: PlatformEventType[] = ["match.start", "match.end", "tournament.fixture", "tournament.end", "stream.live", "stream.clip"];
  deliver(ev: PlatformEvent): void {
    const scene = ev.type === "match.start" ? "MATCH_LIVE"
      : ev.type === "match.end" ? "MATCH_RESULT"
      : ev.type === "tournament.end" ? "TROPHY"
      : ev.type === "stream.clip" ? "REPLAY_CLIP" : "BRACKET";
    this.cues.push({ scene, at: ev.at, payload: ev.data });
  }
}

/** Discord hook (PREPARADO): resúmenes de eventos para un canal. */
export class DiscordHook implements WebhookSink {
  readonly name = "discord";
  readonly messages: string[] = [];
  readonly events: PlatformEventType[] = ["tournament.start", "tournament.end", "match.end", "stream.live"];
  deliver(ev: PlatformEvent): void { this.messages.push(`[${ev.type}] @${ev.actor} t=${ev.at}`); }
}

/** Bus de eventos: publica a los sinks suscritos al tipo. */
export class PlatformEventBus {
  private sinks: WebhookSink[] = [];
  private log: PlatformEvent[] = [];
  subscribe(s: WebhookSink): void { this.sinks.push(s); }
  publish(ev: PlatformEvent): void {
    this.log.push(ev);
    for (const s of this.sinks) {
      if (s.events === "*" || s.events.includes(ev.type)) s.deliver(ev);
    }
  }
  history(type?: PlatformEventType): PlatformEvent[] { return type ? this.log.filter((e) => e.type === type) : this.log.slice(); }
  count(): number { return this.log.length; }
}
