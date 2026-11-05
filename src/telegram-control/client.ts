/**
 * CLIENT — cliente de la Bot API de Telegram con TRANSPORTE INYECTABLE (mismo patrón que el
 * VlrFetcher del Importer VLR): la red vive SOLO detrás de `TelegramTransport`, así los
 * verifies corren 100% offline y deterministas. Sin lógica de negocio: métodos = llamadas
 * literales a la Bot API; los efectos del engine se ejecutan aquí (send/edit/answer).
 */
import type { BotConfig, Effect, InlineKeyboardMarkup } from "./types";

/** POST <apiBase>/bot<token>/<method> con `params` JSON → respuesta `result` de Telegram. */
export type TelegramTransport = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export interface TelegramClient {
  getMe(): Promise<{ id: number; username?: string }>;
  sendMessage(chatId: number, text: string, keyboard?: InlineKeyboardMarkup): Promise<{ message_id: number }>;
  editMessageText(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboardMarkup): Promise<unknown>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<unknown>;
  setMyCommands(commands: { command: string; description: string }[]): Promise<unknown>;
  getUpdates(offset?: number, timeoutSec?: number): Promise<unknown[]>;
}

/** Transporte REAL (long-polling HTTPS contra api.telegram.org). No se usa en verifies. */
export function createHttpTransport(token: string, apiBase = "https://api.telegram.org"): TelegramTransport {
  return async (method, params) => {
    const res = await fetch(`${apiBase}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    const body = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!body.ok) throw new Error(`Telegram ${method}: ${body.description ?? res.status}`);
    return body.result;
  };
}

export function createClient(transport: TelegramTransport): TelegramClient {
  return {
    getMe: async () => (await transport("getMe", {})) as { id: number; username?: string },
    sendMessage: async (chat_id, text, keyboard) =>
      (await transport("sendMessage", {
        chat_id, text, parse_mode: "MarkdownV2",
        ...(keyboard ? { reply_markup: keyboard } : {}),
      })) as { message_id: number },
    editMessageText: (chat_id, message_id, text, keyboard) =>
      transport("editMessageText", {
        chat_id, message_id, text, parse_mode: "MarkdownV2",
        ...(keyboard ? { reply_markup: keyboard } : {}),
      }),
    answerCallbackQuery: (callback_query_id, text) =>
      transport("answerCallbackQuery", { callback_query_id, ...(text ? { text } : {}) }),
    setMyCommands: (commands) => transport("setMyCommands", { commands }),
    getUpdates: async (offset, timeout = 30) =>
      (await transport("getUpdates", { ...(offset !== undefined ? { offset } : {}), timeout })) as unknown[],
  };
}

/** Ejecuta los efectos del engine por orden (mensajes editables; sin duplicados). */
export async function executeEffects(client: TelegramClient, effects: Effect[]): Promise<void> {
  for (const e of effects) {
    if (e.kind === "send") await client.sendMessage(e.chatId, e.text, e.keyboard);
    else if (e.kind === "edit") await client.editMessageText(e.chatId, e.messageId, e.text, e.keyboard);
    else await client.answerCallbackQuery(e.callbackQueryId, e.text);
  }
}

/** Comandos oficiales del bot (para setMyCommands al arrancar). */
export const BOT_COMMANDS: { command: string; description: string }[] = [
  { command: "start", description: "Menú principal" },
  { command: "help", description: "Ayuda y comandos" },
  { command: "status", description: "Estado general del panel" },
  { command: "tournaments", description: "Torneos registrados" },
  { command: "generations", description: "Generaciones de cartas" },
  { command: "runtime", description: "Runtime vigente" },
  { command: "review", description: "Revisión editorial" },
  { command: "publish", description: "Publicación" },
  { command: "rollback", description: "Rollback" },
  { command: "history", description: "Historial" },
  { command: "settings", description: "Configuración" },
];
