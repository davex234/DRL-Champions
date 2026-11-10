/**
 * GLOBAL ESPORTS PLATFORM — vocabulario compartido (Online Fase 7/7 · FINAL).
 *
 * La CAPA SUPERIOR que conecta todo lo construido (Online/Matchmaking/Competitive/Social/Replay/
 * Spectator/Custom/Tournament/Career/World/Presentation) sin duplicar NINGÚN motor. Solo añade la
 * infraestructura de plataforma: transporte, servidores dedicados, routing, analytics, storage,
 * moderación, administración, webhooks/streaming, monitoring y escalado. DESACOPLADA (interfaces +
 * adapters + DI), DETERMINISTA (reloj LÓGICO inyectado, sin Date.now/Math.random), sin ciclos.
 * Depende de todos los motores; NADIE depende de ella.
 */
import type { Region } from "@/domain/cards/types";
import type { ServerKind } from "@/matchmaking";

export type { Region, ServerKind };

/** Hash FNV-1a determinista (mismo que el resto del proyecto) para ids/checksums estables. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Id determinista corto a partir de partes (sin aleatoriedad). */
export const idFrom = (...parts: (string | number)[]): string => fnv1a(parts.join("·")).toString(36);

// ───────────────────────────── Roles / permisos ─────────────────────────────

/** Roles de la plataforma (autorización jerárquica). */
export type PlatformRole = "player" | "observer" | "caster" | "referee" | "moderator" | "admin" | "system";

/** Rango de autoridad (mayor = más permisos). Referee<Moderator<Admin<System. */
export const ROLE_RANK: Record<PlatformRole, number> = {
  player: 0, observer: 0, caster: 1, referee: 2, moderator: 3, admin: 4, system: 5,
};
export const hasRank = (role: PlatformRole, min: PlatformRole): boolean => ROLE_RANK[role] >= ROLE_RANK[min];

export interface Principal { id: string; role: PlatformRole; region?: Region }

// ───────────────────────────── Transporte / protocolo ─────────────────────────────

/** Backends de transporte soportados (adapters). */
export type PlatformTransportKind = "loopback" | "websocket" | "realtime" | "lan" | "offline" | "cloud";

// ───────────────────────────── Instancias / servidores ─────────────────────────────

export type InstanceState = "provisioning" | "ready" | "active" | "draining" | "down";
export type HealthStatus = "healthy" | "degraded" | "unhealthy";

/** Una instancia de servidor de juego (envuelve un `ServerNode` del matchmaking). */
export interface Instance {
  id: string;
  region: Region;
  kind: ServerKind;
  capacity: number;      // nº de partidas simultáneas
  load: number;          // partidas activas
  state: InstanceState;
  health: HealthStatus;
  lastBeatAt: number;    // reloj lógico del último heartbeat
  startedAt: number;
  matches: string[];     // ids de partidas alojadas
}

// ───────────────────────────── Sesiones / routing ─────────────────────────────

export type SessionState = "handshaking" | "authenticated" | "routed" | "rejected" | "closed";
export interface PlatformSession {
  id: string;
  principal: Principal;
  transport: PlatformTransportKind;
  protocol: number;
  state: SessionState;
  instanceId: string | null;
  openedAt: number;
  reason?: string;
}

// ───────────────────────────── Eventos de plataforma ─────────────────────────────

export type PlatformEventType =
  | "session.open" | "session.route" | "session.close" | "session.reject"
  | "instance.up" | "instance.down" | "instance.scale_up" | "instance.scale_down" | "instance.failover"
  | "match.start" | "match.end" | "match.registered"
  | "tournament.start" | "tournament.fixture" | "tournament.end"
  | "replay.stored" | "replay.shared"
  | "moderation.report" | "moderation.action" | "moderation.appeal"
  | "stream.live" | "stream.offline" | "stream.clip"
  | "alert.health" | "alert.recovery"
  | "api.call";

export interface PlatformEvent<T = unknown> {
  id: string;
  type: PlatformEventType;
  at: number;            // reloj lógico
  actor: string;         // principal id / "system"
  region?: Region;
  data: T;
}

/** Fábrica determinista de eventos (id estable por (type, at, seq)). */
export function makeEvent<T>(seq: number, type: PlatformEventType, at: number, actor: string, data: T, region?: Region): PlatformEvent<T> {
  return { id: idFrom("ev", type, at, seq), type, at, actor, region, data };
}
