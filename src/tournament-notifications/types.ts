/**
 * TOURNAMENT WATCHER · NOTIFICATION HUB — tipos (Tournament Watcher · Fase 4/5).
 *
 * DISTRIBUYE notificaciones, nada más: PipelineRequest → NotificationPlan →
 * NotificationMessage por canal. Jamás ejecuta peticiones, jamás aprueba, jamás publica,
 * jamás envía por APIs reales (los canales son ADAPTADORES con salida inyectada/buffer).
 */
import type { WatchEvent } from "@/tournament-watcher";
import type { PipelineRequest } from "@/tournament-autopipeline";

export const NOTIFICATIONS_SCHEMA_VERSION = 1;

/* ── Tipos de notificación (plantillas del contrato) ──────────────────────── */

export type NotificationKind =
  | "new-tournament" | "team-eliminated" | "new-review" | "full-review"
  | "stats-updated" | "pipeline-pending" | "error";

export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  "new-tournament", "team-eliminated", "new-review", "full-review",
  "stats-updated", "pipeline-pending", "error",
] as const;

/* ── Contexto (lo aporta el llamador; el hub no consulta motores) ─────────── */

export interface NotificationContext {
  /** Nombre humano del torneo (si se conoce; si no, el id). */
  tournamentName?: string;
  /** Eventos origen de la petición (para extraer el sujeto: equipo/jugador). */
  events?: WatchEvent[];
  /** Mensaje de error (solo kind "error"). */
  error?: string;
}

/* ── Mensajes ─────────────────────────────────────────────────────────────── */

export type MessageState = "pending" | "sent" | "failed" | "retryable" | "cancelled";

export interface NotificationMessage {
  /** Id determinista: `<dedupeKey>#<n>`. */
  id: string;
  kind: NotificationKind;
  channelId: string;
  /** Destino dentro del canal (p.ej. "operators"). */
  target: string;
  title: string;
  body: string;
  /** Cuerpo YA formateado para el canal (MarkdownV2 en telegram, texto plano en consola…). */
  rendered: string;
  tournamentId: string;
  requestId?: string;
  state: MessageState;
  attempts: number;
  /** Clave de deduplicación: un mensaje ya ENVIADO con esta clave jamás se reenvía. */
  dedupeKey: string;
  createdAt: number;
  updatedAt: number;
  detail?: string;
}

export interface NotificationPlan {
  messages: NotificationMessage[];
  /** Descartes por deduplicación (ya enviado o ya en cola). */
  deduped: number;
  /** Canales saltados por health()=false. */
  skippedChannels: string[];
}

/* ── Canales (adaptadores; jamás APIs reales) ─────────────────────────────── */

export interface ChannelSendResult {
  ok: boolean;
  detail?: string;
}

export interface NotificationChannel {
  readonly id: string;
  priority(): number;
  health(): boolean;
  /** Entrega el mensaje AL ADAPTADOR (buffer/colector inyectado). Nunca red. */
  send(message: NotificationMessage): ChannelSendResult;
}

/* ── Política de enrutado (datos) ─────────────────────────────────────────── */

export interface RoutingPolicy {
  /** Canales por tipo de notificación (ids); ausente ⇒ defaultChannels. */
  byKind: Partial<Record<NotificationKind, string[]>>;
  defaultChannels: string[];
  /** Destino por canal. */
  targetByChannel: Record<string, string>;
  /** Reintentos de entrega al adaptador. */
  maxAttempts: number;
}

/* ── Historial y registry ─────────────────────────────────────────────────── */

export interface HubHistoryEntry {
  seq: number;
  at: number;
  messageId: string;
  channelId: string;
  target: string;
  kind: NotificationKind;
  state: MessageState;
  attempts: number;
  detail?: string;
}

export interface HubRegistry {
  schemaVersion: number;
  messages: Record<string, NotificationMessage>;
  order: string[];
  history: HubHistoryEntry[];
  /** Claves ya ENVIADAS (dedupe permanente: jamás reenviar). */
  sentKeys: string[];
  perKey: Record<string, number>;
  seq: number;
}

export interface HubMetrics {
  messages: number;
  pending: number;
  sent: number;
  failed: number;
  retryable: number;
  cancelled: number;
  deduped: number;
  byChannel: Record<string, number>;
}

export type HubClock = () => number;

/** Petición mínima que el hub necesita (compatible con el Auto Pipeline F3). */
export type HubRequest = Pick<PipelineRequest, "id" | "tournamentId" | "action" | "reason" | "sourceEventSeqs">;
