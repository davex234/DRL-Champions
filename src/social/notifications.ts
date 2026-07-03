/**
 * NOTIFICATION ENGINE — buzón por usuario con anti-spam (Online Fase 4/7).
 *
 * Dedupe por (destino,tipo,origen) dentro de una ventana → protección contra spam. PURO respecto
 * al reloj. Determinista.
 */
import type { UserId, Notification, NotificationType } from "./types";

export class NotificationEngine {
  private byUser = new Map<UserId, Notification[]>();
  private dedupe = new Map<string, number>();
  private counter = 0;

  push(to: UserId, type: NotificationType, from: UserId | null, text: string, now: number, windowTicks = 20): Notification | null {
    const key = `${to}:${type}:${from ?? ""}`;
    const last = this.dedupe.get(key);
    if (last != null && now - last < windowTicks) return null;   // anti-spam
    this.dedupe.set(key, now);
    const n: Notification = { id: `ntf-${this.counter++}`, type, to, from, text, at: now, read: false };
    const arr = this.byUser.get(to) ?? []; arr.unshift(n); this.byUser.set(to, arr.slice(0, 100));
    return n;
  }

  all(to: UserId): Notification[] { return this.byUser.get(to) ?? []; }
  unread(to: UserId): number { return (this.byUser.get(to) ?? []).filter((n) => !n.read).length; }
  markRead(to: UserId): void { for (const n of this.byUser.get(to) ?? []) n.read = true; }
}
