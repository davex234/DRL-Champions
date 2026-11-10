/**
 * TELEGRAM CONTROL CENTER — tipos (Tournament Automation · Fase 6/6).
 *
 * Telegram es EXCLUSIVAMENTE una interfaz remota del Tournament Control Center: cada acción
 * delega en las APIs públicas de `src/tournament-control/` (que a su vez componen Orchestrator
 * → Editorial → Publisher) y cada pantalla es una proyección formateada de sus vistas. Aquí no
 * vive NINGUNA lógica de negocio: solo tipos de la Bot API (subconjunto mínimo), sesiones de
 * chat, configuración y el modelo puro de efectos (update entrante → efectos salientes).
 */
import type { ControlLedger, RuntimeInfo } from "@/tournament-control";
import type { OrchestratorResult } from "@/tournament-orchestrator";
import type { Player } from "@/domain/cards/types";

export const TELEGRAM_CONTROL_SCHEMA_VERSION = 1;

/* ── Subconjunto mínimo de la Bot API de Telegram ─────────────────────────── */

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type?: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date?: number;
  text?: string;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

/* ── Configuración ────────────────────────────────────────────────────────── */

export interface BotConfig {
  token: string;
  /** Lista blanca de userIds autorizados. VACÍA = nadie autorizado (seguro por defecto). */
  allowedUsers: number[];
  /** Nombre visible del bot (cabeceras de pantalla). */
  botName: string;
}

/* ── Sesiones (solo usuario · chat · último menú · preferencias) ──────────── */

export interface SessionPreferences {
  /** Recibir notificaciones (generación/publicación/rollback/errores). */
  notifications: boolean;
}

export interface ChatSession {
  userId: number;
  chatId: number;
  /** Última pantalla mostrada (p.ej. "main", "tournaments", "generation:0"). */
  lastMenu: string;
  /** recordId del registro seleccionado en el panel (contexto de navegación, no dominio). */
  selected?: string;
  /** callback_data pendiente de confirmación (flujo Confirmar/Cancelar). */
  pendingConfirm?: string;
  preferences: SessionPreferences;
}

export type SessionMap = Record<number, ChatSession>;

/* ── Efectos (salidas del engine: puras, ejecutables por el cliente) ──────── */

export type Effect =
  | { kind: "send"; chatId: number; text: string; keyboard?: InlineKeyboardMarkup }
  | { kind: "edit"; chatId: number; messageId: number; text: string; keyboard?: InlineKeyboardMarkup }
  | { kind: "answerCallback"; callbackQueryId: string; text?: string };

/** Pantalla renderizada (texto MarkdownV2 + teclado inline). */
export interface Screen {
  text: string;
  keyboard?: InlineKeyboardMarkup;
}

/* ── Estado del engine (ledger del Control Center + sesiones) ─────────────── */

export interface TelegramControlState {
  /** El MISMO ControlLedger del Tournament Control Center (fuente única del panel). */
  ledger: ControlLedger;
  sessions: SessionMap;
}

export interface HandleResult {
  state: TelegramControlState;
  effects: Effect[];
}

/** Contexto del engine: reloj lógico + accesores/acciones INYECTADOS (verifies offline). */
export interface EngineCtx {
  config: BotConfig;
  /** Reloj lógico del update (fecha de todas las decisiones que dispare). */
  now: number;
  /** Arranque del bot (pantalla Runtime: tiempo activo). */
  startedAt: number;
  /** Roster vivo para publishRecord (por defecto el llamador pasa allPlayers). */
  roster: () => Player[];
  /** Runtime vigente (currentRuntimeInfo del Control Center). */
  rt: () => RuntimeInfo;
  /** Total de cartas del catálogo vivo (pantalla Runtime). */
  totalCards: () => number;
  /** Run completo del Orchestrator para una URL (opcional; sin él "Generar cartas" se limita a informar). */
  runPipeline?: (url: string) => Promise<OrchestratorResult>;
}

/* ── Notificaciones (infraestructura; el Watcher NO existe todavía) ───────── */

export type NotificationKind =
  | "generation-completed"
  | "publish-completed"
  | "rollback-completed"
  | "generation-error"
  | "publish-error";

export interface NotificationEvent {
  kind: NotificationKind;
  generationId: string;
  at: number;
  detail?: string;
  error?: string;
}
