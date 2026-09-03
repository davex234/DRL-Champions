/**
 * TOURNAMENT WATCHER · NOTIFICATION HUB — API pública (Fase 4/5).
 *
 * PipelineRequest → NotificationPlan → NotificationMessage por canal (plantillas
 * deterministas, dedupe permanente, cola con reintentos y auditoría). Los canales son
 * ADAPTADORES (console/telegram/discord-stub) sin APIs reales. Jamás ejecuta, aprueba,
 * publica ni envía de verdad.
 */
export * from "./types";
export { DEFAULT_ROUTING, kindOfRequest, channelsFor } from "./routing";
export { renderTemplate, subjectOf, type RenderedTemplate } from "./templates";
export { renderForChannel } from "./formatter";
export { rankChannels, ConsoleChannel, TelegramChannelAdapter, DiscordChannelAdapter } from "./channels";
export { createHubRegistry, enqueue, dispatch, cancelMessage, pendingMessages } from "./queue";
export { appendHubHistory, historyOfMessage, auditHub } from "./history";
export { hubMetrics } from "./metrics";
export { NotificationHub } from "./engine";
