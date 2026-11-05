/**
 * CHANNELS — arquitectura por canales (send · health · priority) con TRES adaptadores SIN
 * APIs reales: ConsoleChannel (sink inyectado), TelegramChannelAdapter (produce Effects
 * del Telegram Control congelado hacia un buffer: un host futuro los ejecutaría con su
 * cliente) y DiscordChannelAdapter (stub desconectado). Aquí no existe la red.
 */
import type { Effect } from "@/telegram-control";
import type { ChannelSendResult, NotificationChannel, NotificationMessage } from "./types";

/** Orden de entrega: salud primero, prioridad después (determinista). */
export function rankChannels(channels: NotificationChannel[]): NotificationChannel[] {
  return channels.filter((c) => c.health())
    .sort((a, b) => b.priority() - a.priority() || (a.id < b.id ? -1 : 1));
}

/* ── Consola ──────────────────────────────────────────────────────────────── */

export class ConsoleChannel implements NotificationChannel {
  readonly id = "console";
  readonly lines: string[] = [];
  constructor(private sink: (line: string) => void = (l) => { this.lines.push(l); }) {}
  priority(): number { return 10; }
  health(): boolean { return true; }
  send(m: NotificationMessage): ChannelSendResult {
    this.sink(`(${m.target}) ${m.rendered}`);
    return { ok: true };
  }
}

/* ── Telegram (adaptador: Effects del Telegram Control, sin transporte) ───── */

export class TelegramChannelAdapter implements NotificationChannel {
  readonly id = "telegram";
  /** Effects listos para un ejecutor futuro (el cliente del Telegram Control). AQUÍ no se envían. */
  readonly outbox: Effect[] = [];
  constructor(private chatIdOf: (target: string) => number = () => 0) {}
  priority(): number { return 100; }
  health(): boolean { return true; }
  send(m: NotificationMessage): ChannelSendResult {
    this.outbox.push({ kind: "send", chatId: this.chatIdOf(m.target), text: m.rendered });
    return { ok: true, detail: "encolado en el adaptador (sin transporte)" };
  }
}

/* ── Discord (stub: presente pero desconectado) ───────────────────────────── */

export class DiscordChannelAdapter implements NotificationChannel {
  readonly id = "discord";
  priority(): number { return 50; }
  /** Stub: sin conexión hasta una fase futura. */
  health(): boolean { return false; }
  send(): ChannelSendResult {
    return { ok: false, detail: "stub: Discord no conectado" };
  }
}
