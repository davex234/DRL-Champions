/**
 * MATCHMAKING & QUEUE — vocabulario compartido (Online Fase 2/7).
 *
 * Sistema de EMPAREJAMIENTO que se apoya en el Online Core (Fase 1) y en el ÚNICO Gameplay.
 * NO crea otro Lobby/Match/Server/Gameplay: encuentra partidas y delega en `@/online`. Flujo
 * único: Player → Queue → Search → Match Builder → Lobby → Session → Server → Gameplay. Todo
 * PLANO/clonable y DETERMINISTA sobre un reloj LÓGICO (sin Date.now/Math.random). Depende de
 * `@/online` (NUNCA al revés). No es ranking/amigos/torneos (fases posteriores).
 */
import type { Region } from "@/domain/cards/types";
import type { Role, RosterEntry } from "@/sim";

export type { Region };
/** Rol del sim (composición / preferencias). */
export type SimRole = Role;

// ───────────────────────────── Modos ─────────────────────────────

export type QueueMode = "casual" | "competitive" | "custom" | "practice" | "ai_match" | "lan" | "offline_local" | "dedicated";
/** Modos que emparejan contra otros jugadores (los demás resuelven al instante contra bots/directo). */
export const PVP_MODES: QueueMode[] = ["casual", "competitive"];
export const INSTANT_MODES: QueueMode[] = ["practice", "ai_match", "offline_local"];

// ───────────────────────────── Perfil del jugador ─────────────────────────────

/** Perfil DESACOPLADO para emparejar (se deriva de career/development/identity o valores por defecto). */
export interface PlayerProfile {
  id: string;
  name: string;
  mmr: number;          // 1500 por defecto (Elo)
  skill: number;        // 0..100 (progreso de desarrollo)
  level: number;
  experience: number;
  region: Region;
  coachRating: number;  // 0..100 (career) — 0 si no hay
  rolePrefs: SimRole[]; // orden de preferencia
  roster: RosterEntry[] | null; // su quinteto (5); null ⇒ se genera/bot
  partyId: string | null;
}

/** Party (solo INFRAESTRUCTURA en esta fase). */
export interface Party { id: string; leaderId: string; memberIds: string[]; region: Region }

// ───────────────────────────── Cola / ticket ─────────────────────────────

export type TicketState = "searching" | "proposed" | "ready_check" | "matched" | "cancelled" | "expired" | "requeued";

export interface QueueTicket {
  id: string;
  profile: PlayerProfile;
  mode: QueueMode;
  region: Region;
  enqueuedAt: number;   // reloj lógico
  priority: number;     // mayor = antes
  state: TicketState;
  proposalId: string | null;
  serverPref: ServerKind | null;
  retries: number;
}

// ───────────────────────────── Búsqueda ─────────────────────────────

export interface SearchWindow {
  mmrRange: number;     // ± MMR aceptable
  pingMax: number;      // ms máximos
  regionStrict: boolean;
  minQuality: number;   // calidad mínima 0..100
}

// ───────────────────────────── Servidores ─────────────────────────────

export type ServerKind = "local" | "dedicated" | "lan" | "offline" | "cloud";
export interface ServerNode { id: string; kind: ServerKind; region: Region; load: number; capacity: number }

// ───────────────────────────── Propuesta / ready check ─────────────────────────────

export type ReadyStatus = "pending" | "ready" | "failed";
export interface ReadyCheck {
  proposalId: string;
  needed: string[];     // ticket ids que deben aceptar
  accepted: string[];
  declined: string[];
  deadlineAt: number;
  status: ReadyStatus;
}

export interface MatchProposal {
  id: string;
  mode: QueueMode;
  createdAt: number;
  teamHome: string[];   // ticket ids (1 por lado en esta fase; array = extensible a party)
  teamAway: string[];
  botsHome: number;
  botsAway: number;
  server: ServerNode;
  seed: number;
  quality: number;      // 0..100 equilibrio
  readyCheck: ReadyCheck;
}

// ───────────────────────────── Snapshot / métricas / eventos ─────────────────────────────

export interface QueueSnapshot {
  mode: QueueMode;
  size: number;
  byRegion: Record<string, number>;
  oldestWait: number;
  estimatedWait: number;
  health: number;       // 0..100
}

export interface QueueMetrics {
  enqueued: number;
  matched: number;
  cancelled: number;
  expired: number;
  declined: number;
  searches: number;
  avgWaitTicks: number;
}

export type MatchmakingEventType =
  | "enqueued" | "cancelled" | "proposed" | "ready_check" | "accepted" | "declined"
  | "matched" | "expired" | "requeued" | "backfilled" | "launched";
export interface MatchmakingEvent { type: MatchmakingEventType; at: number; data?: unknown }
