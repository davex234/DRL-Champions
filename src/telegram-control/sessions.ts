/**
 * SESSIONS — sesiones de chat PURAS e inmutables. Persisten ÚNICAMENTE usuario, chatId,
 * último menú y preferencias (más el contexto efímero de navegación/confirmación). Jamás
 * lógica ni datos del juego: el dominio vive en el ControlLedger y en los motores.
 */
import type { ChatSession, SessionMap } from "./types";

export function createSessions(): SessionMap {
  return {};
}

export function getSession(sessions: SessionMap, userId: number, chatId: number): ChatSession {
  return sessions[chatId] ?? {
    userId, chatId, lastMenu: "main",
    preferences: { notifications: true },
  };
}

/** Devuelve un mapa NUEVO con la sesión actualizada (nunca muta). */
export function putSession(sessions: SessionMap, session: ChatSession): SessionMap {
  return { ...sessions, [session.chatId]: session };
}

export function withMenu(s: ChatSession, lastMenu: string, selected?: string): ChatSession {
  return { ...s, lastMenu, selected: selected ?? s.selected, pendingConfirm: undefined };
}

export function withPendingConfirm(s: ChatSession, pendingConfirm: string): ChatSession {
  return { ...s, pendingConfirm };
}

export function toggleNotifications(s: ChatSession): ChatSession {
  return { ...s, preferences: { ...s.preferences, notifications: !s.preferences.notifications } };
}

/** ChatIds suscritos a notificaciones. Orden estable (numérico). */
export function subscribedChats(sessions: SessionMap): number[] {
  return Object.values(sessions)
    .filter((s) => s.preferences.notifications)
    .map((s) => s.chatId)
    .sort((a, b) => a - b);
}

/** Serialización de sesiones (solo los campos persistibles del contrato). */
export function serializeSessions(sessions: SessionMap): string {
  const clean = Object.fromEntries(Object.entries(sessions).map(([k, s]) => [k, {
    userId: s.userId, chatId: s.chatId, lastMenu: s.lastMenu, preferences: s.preferences,
  }]));
  return JSON.stringify(clean);
}

export function deserializeSessions(json: string): SessionMap {
  const raw = JSON.parse(json) as Record<string, ChatSession>;
  const out: SessionMap = {};
  for (const k of Object.keys(raw)) {
    const s = raw[k];
    out[s.chatId] = {
      userId: s.userId, chatId: s.chatId, lastMenu: s.lastMenu ?? "main",
      preferences: { notifications: s.preferences?.notifications ?? true },
    };
  }
  return out;
}
