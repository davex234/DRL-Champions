/**
 * NOTIFICATIONS — infraestructura de avisos (generación · publicación · rollback · errores)
 * para los chats suscritos. SOLO construye efectos a partir de eventos ya ocurridos en los
 * motores; el Tournament Watcher (detección automática) NO existe todavía y no se implementa
 * aquí: quien produce eventos es el engine al ejecutar acciones (o un host futuro).
 */
import type { Effect, NotificationEvent, NotificationKind, SessionMap } from "./types";
import { b, code, esc } from "./formatter";
import { subscribedChats } from "./sessions";

const HEADLINE: Record<NotificationKind, string> = {
  "generation-completed": "🃏 Generación completada",
  "publish-completed": "🚀 Publicación completada",
  "rollback-completed": "⟲ Rollback completado",
  "generation-error": "❌ Error de generación",
  "publish-error": "❌ Error de publicación",
};

export function fmtNotification(ev: NotificationEvent): string {
  return `${b(HEADLINE[ev.kind])}\n` +
    (ev.generationId ? `${code(ev.generationId)}\n` : "") +
    (ev.detail ? `${esc(ev.detail)}\n` : "") +
    (ev.error ? `⚠ ${esc(ev.error)}` : "");
}

/** Efectos de notificación para TODOS los chats suscritos (orden estable). */
export function notificationEffects(sessions: SessionMap, ev: NotificationEvent): Effect[] {
  const text = fmtNotification(ev);
  return subscribedChats(sessions).map((chatId): Effect => ({ kind: "send", chatId, text }));
}
