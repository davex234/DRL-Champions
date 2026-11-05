/**
 * TELEGRAM CONTROL CENTER — API pública (Tournament Automation · Fase 6/6, FINAL).
 *
 * Interfaz remota OFICIAL del Tournament Control Center vía Telegram:
 *
 *   Telegram → Telegram Control → Tournament Control Center → (Orchestrator → Editorial →
 *   Publisher)
 *
 * Cero lógica de negocio: comandos y botones = pantallas proyectadas del panel; acciones =
 * llamadas públicas del Control Center (openReview/decide/approveGeneration/publishRecord/
 * rollbackRecord/ingestRun); seguridad por lista blanca; acciones sensibles con confirmación;
 * MarkdownV2 + mensajes editables; red SOLO detrás de `TelegramTransport` inyectable.
 */
export * from "./types";
export { makeConfig, configFromEnv, isAuthorized, DEFAULT_BOT_NAME } from "./config";
export {
  createClient, createHttpTransport, executeEffects, BOT_COMMANDS,
  type TelegramClient, type TelegramTransport,
} from "./client";
export {
  createSessions, getSession, putSession, withMenu, withPendingConfirm, toggleNotifications,
  subscribedChats, serializeSessions, deserializeSessions,
} from "./sessions";
export { esc, b, code, fmtStatus } from "./formatter";
export { fmtNotification, notificationEffects } from "./notifications";
export { routeCommand, REVIEW_PAGE_SIZE, type CommandResult } from "./commands";
export { isSensitive, confirmQuestion, executeCallback, type CallbackOutcome } from "./callbacks";
export {
  mainMenu, tournamentListMenu, tournamentMenu, generationListMenu, generationMenu,
  reviewMenu, reviewClosedMenu, publishMenu, confirmMenu, settingsMenu, homeMenu, backRow,
} from "./menus";
export { handleUpdate, notify, VLR_URL_RE } from "./engine";
