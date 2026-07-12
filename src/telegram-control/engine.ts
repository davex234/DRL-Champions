/**
 * TELEGRAM CONTROL ENGINE — núcleo puro del bot: `handleUpdate(state, update, ctx)` →
 * nuevo estado + efectos (send/edit/answer). Seguridad primero (lista blanca), luego enrutado:
 * comandos → pantallas; callbacks → confirmación (si es sensible) → acción del Tournament
 * Control Center. Determinista con reloj lógico inyectado; la red vive en client.ts.
 */
import { isAuthorized } from "./config";
import { routeCommand } from "./commands";
import { confirmQuestion, executeCallback, isSensitive } from "./callbacks";
import { fmtConfirm, fmtUnauthorized } from "./formatter";
import { confirmMenu } from "./menus";
import { notificationEffects } from "./notifications";
import { getSession, putSession, withMenu, withPendingConfirm } from "./sessions";
import type {
  ChatSession, Effect, EngineCtx, HandleResult, NotificationEvent, Screen,
  TelegramControlState, TgUpdate,
} from "./types";

export const VLR_URL_RE = /https?:\/\/(?:www\.)?vlr\.gg\/event\/\S+/i;

const editOrSend = (screen: Screen, chatId: number, messageId?: number): Effect =>
  messageId !== undefined
    ? { kind: "edit", chatId, messageId, text: screen.text, keyboard: screen.keyboard }
    : { kind: "send", chatId, text: screen.text, keyboard: screen.keyboard };

/** Un update de Telegram → nuevo estado + efectos. NUNCA lanza por acciones rechazadas. */
export async function handleUpdate(
  state: TelegramControlState, update: TgUpdate, ctx: EngineCtx,
): Promise<HandleResult> {

  /* ── Mensajes de texto (comandos y URLs de vlr.gg) ── */
  if (update.message?.text !== undefined) {
    const msg = update.message;
    const text = (msg.text ?? "").trim();
    const userId = msg.from?.id;
    if (!isAuthorized(ctx.config, userId)) {
      return { state, effects: [{ kind: "send", chatId: msg.chat.id, text: fmtUnauthorized() }] };
    }
    let session = getSession(state.sessions, userId!, msg.chat.id);

    if (text.startsWith("/")) {
      const cmd = text.split(/[\s@]/)[0].toLowerCase();
      const r = routeCommand(cmd, state, session, ctx);
      session = withMenu(session, r.menu);
      return {
        state: { ...state, sessions: putSession(state.sessions, session) },
        effects: [{ kind: "send", chatId: msg.chat.id, text: r.screen.text, keyboard: r.screen.keyboard }],
      };
    }

    const url = text.match(VLR_URL_RE)?.[0];
    if (url) {
      // Acción sensible: generar cartas desde una URL requiere confirmación explícita.
      session = withPendingConfirm(withMenu(session, "confirm"), `run:${url}`);
      return {
        state: { ...state, sessions: putSession(state.sessions, session) },
        effects: [{
          kind: "send", chatId: msg.chat.id,
          text: fmtConfirm(confirmQuestion(state, `run:${url}`)), keyboard: confirmMenu(),
        }],
      };
    }

    const r = routeCommand("/help", state, session, ctx);
    return { state, effects: [{ kind: "send", chatId: msg.chat.id, text: r.screen.text, keyboard: r.screen.keyboard }] };
  }

  /* ── Callbacks de botones inline ── */
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id ?? cq.from.id;
    const messageId = cq.message?.message_id;
    if (!isAuthorized(ctx.config, cq.from.id)) {
      return { state, effects: [{ kind: "answerCallback", callbackQueryId: cq.id, text: "⛔ No autorizado" }] };
    }
    let session = getSession(state.sessions, cq.from.id, chatId);
    const data = cq.data ?? "";

    // Confirmación pendiente: Confirmar ejecuta la acción guardada; Cancelar la descarta.
    if (data === "cf:yes" || data === "cf:no") {
      const pending = session.pendingConfirm;
      if (data === "cf:no" || !pending) {
        const r = routeCommand("/status", state, withMenu(session, "status"), ctx);
        return {
          state: { ...state, sessions: putSession(state.sessions, withMenu(session, "status")) },
          effects: [
            { kind: "answerCallback", callbackQueryId: cq.id, text: pending ? "🚫 Cancelado" : undefined },
            editOrSend(r.screen, chatId, messageId),
          ],
        };
      }
      return runCallback(state, withMenu(session, session.lastMenu), pending, cq.id, chatId, messageId, ctx);
    }

    // Acción sensible → pedir confirmación SIN ejecutar nada.
    if (isSensitive(data)) {
      session = withPendingConfirm(session, data);
      return {
        state: { ...state, sessions: putSession(state.sessions, session) },
        effects: [
          { kind: "answerCallback", callbackQueryId: cq.id },
          editOrSend({ text: fmtConfirm(confirmQuestion(state, data)), keyboard: confirmMenu() }, chatId, messageId),
        ],
      };
    }

    return runCallback(state, session, data, cq.id, chatId, messageId, ctx);
  }

  return { state, effects: [] };
}

/** Ejecuta un callback (ya confirmado si era sensible) y materializa sus efectos. */
async function runCallback(
  state: TelegramControlState, session: ChatSession, data: string,
  callbackQueryId: string, chatId: number, messageId: number | undefined, ctx: EngineCtx,
): Promise<HandleResult> {
  const out = await executeCallback(state, session, data, ctx);
  const finalSession = withMenu(out.session, out.menu);
  const effects: Effect[] = [
    { kind: "answerCallback", callbackQueryId, text: out.toast },
    editOrSend(out.screen, chatId, messageId),
    ...(out.notifications ?? []).flatMap((ev) => notificationEffects(out.state.sessions, ev)),
  ];
  return {
    state: { ...out.state, sessions: putSession(out.state.sessions, finalSession) },
    effects,
  };
}

/** Emite una notificación externa (host/futuro Watcher) a los chats suscritos. */
export function notify(state: TelegramControlState, ev: NotificationEvent): Effect[] {
  return notificationEffects(state.sessions, ev);
}
