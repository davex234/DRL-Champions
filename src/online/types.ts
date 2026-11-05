/**
 * ONLINE CORE — vocabulario compartido (Online Fase 1/7).
 *
 * La capa online es una EXTENSIÓN desacoplada que conduce el ÚNICO Gameplay existente
 * (`@/sim` + `@/match`) de forma AUTORITATIVA. No hay dos simulaciones: el servidor posee el
 * `MatchState` y avanza el sim determinista; los clientes envían intención (comandos) y reciben
 * snapshots/deltas del MISMO `RoundState` que ya renderiza el juego. Todo PLANO/clonable y
 * DETERMINISTA sobre un reloj LÓGICO inyectado (sin Date.now/Math.random en el núcleo).
 */
import type { RoundState } from "@/sim";
import type { MatchState, MatchPhase } from "@/match";

// ───────────────────────────── Identidad y roles ─────────────────────────────

export type ClientKind = "player" | "observer" | "server" | "bot";

/** Identidad de un cliente. La capa de auth (Supabase) es OPCIONAL (local-first). */
export interface ClientIdentity {
  id: string;         // estable (user.id de Supabase, o anónimo determinista)
  name: string;
  kind: ClientKind;
  /** Token bearer (JWT de Supabase) — preparado; null en anónimo/LAN. */
  token: string | null;
  /** Lado que controla en el partido (solo "player"). */
  side?: "home" | "away";
}

// ───────────────────────────── Estado de red ─────────────────────────────

export type ConnectionStatus =
  | "disconnected" | "connecting" | "handshaking" | "authenticating"
  | "connected" | "reconnecting" | "closed";

export interface NetworkState {
  status: ConnectionStatus;
  protocol: number;
  rtt: number;          // ms (estimado)
  jitter: number;
  reconnects: number;
  since: number;        // logical clock del último cambio de estado
  clockOffset: number;  // offset con el reloj del servidor
  serverTick: number;   // último tick autoritativo conocido
}

// ───────────────────────────── Paquetes / protocolo ─────────────────────────────

export type PacketType =
  | "hello" | "welcome" | "reject"          // handshake + versionado
  | "auth" | "auth_ok"                        // capa de autenticación (preparada)
  | "ping" | "pong"                           // heartbeat / latencia / reloj
  | "join_lobby" | "lobby_state" | "ready" | "start"  // lobby
  | "command"                                 // intención del cliente (autoridad servidor)
  | "snapshot" | "delta" | "match_state"      // replicación
  | "resync" | "leave" | "bye" | "error";     // control

/** Sobre de paquete. `payload` se tipa por `type` en los constructores/lectores. */
export interface Packet {
  protocol: number;
  type: PacketType;
  seq: number;          // secuencia del emisor (orden/dedupe)
  ack: number;          // último seq recibido del otro extremo
  ts: number;           // reloj lógico del emisor
  from: string;         // id del cliente emisor ("" = servidor)
  payload: unknown;
  checksum: number;     // integridad (anti-paquete-inválido)
}

// ───────────────────────────── Comandos (intención) ─────────────────────────────

/** Un comando temporizado: la única entrada exógena al sim. Reproduce el partido (replay). */
export interface TimedCommand {
  round: number;        // índice de ronda (0-based) — determinista
  tick: number;         // tick de ronda en el que se aplica
  from: string;         // cliente que lo emitió
  kind: "command" | "call";
  id: string;           // CoachCommandId | CoachCallId
  side: "home" | "away";// autoridad: qué lado puede emitirlo
}

/** Log de entradas: `seed` + comandos ordenados ⇒ reconstrucción byte a byte del partido. */
export interface InputLog {
  seed: number;
  commands: TimedCommand[];
}

// ───────────────────────────── Replicación (World Snapshot / Delta) ─────────────────────────────

/** Snapshot COMPLETO de una ronda (para join/reconexión). `RoundState` YA es serializable. */
export interface RoundSnapshot {
  serverTick: number;
  round: RoundState | null;
  match: MatchScalars;
}

/** Escalares de partido replicados (serie). El resto se re-deriva en cliente. */
export interface MatchScalars {
  phase: MatchPhase;
  roundNumber: number;
  currentHomeSide: "ATK" | "DEF";
  score: { home: number; away: number };
  winner: "home" | "away" | null;
}

/** Delta incremental de una ronda: solo lo cambiado desde el tick anterior. */
export interface RoundDelta {
  serverTick: number;
  roundTick: number;
  phase: RoundState["phase"];
  /** Jugadores cambiados (subset), por id. */
  players: PlayerDelta[];
  /** Eventos NUEVOS (append-only): `events.slice(prevLen)`. */
  events: RoundState["events"];
  spike: RoundState["spike"];
  winner: RoundState["winner"];
  match?: MatchScalars; // solo cuando cambian los escalares
}

export interface PlayerDelta {
  id: string;
  pos?: { x: number; y: number };
  facing?: number;
  alive?: boolean;
  hp?: number;
  intent?: string;
  targetEnemyId?: string | null;
}

// ───────────────────────────── Eventos de red ─────────────────────────────

export type NetworkEventType =
  | "connected" | "disconnected" | "reconnected" | "kicked"
  | "lobby_joined" | "lobby_updated" | "match_started"
  | "snapshot" | "delta" | "match_updated" | "latency" | "error";

export interface NetworkEvent {
  type: NetworkEventType;
  at: number;           // reloj lógico
  data?: unknown;
}

// ───────────────────────────── Utilidades de tipo ─────────────────────────────

export type { RoundState, MatchState };
