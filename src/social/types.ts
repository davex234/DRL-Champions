/**
 * SOCIAL — Friends, Party & Presence — vocabulario compartido (Online Fase 4/7).
 *
 * Infraestructura SOCIAL desacoplada que se apoya en el Online Core (identidad/sesión/lobby),
 * el Matchmaking (una Party entra en cola como grupo) y Competitive (rich presence con rango).
 * NO crea otro Lobby/Match/Session/Identity/Profile. Flujo único: Friend → Party → Lobby →
 * Matchmaking → Online Session → Gameplay. Todo PLANO/clonable y DETERMINISTA (reloj lógico).
 * Depende de matchmaking/online/competitive (nunca al revés). No es torneos/clanes/marketplace.
 */
import type { Region } from "@/domain/cards/types";

export type UserId = string;

// ───────────────────────────── Amigos ─────────────────────────────

export type FriendState = "none" | "requested" | "incoming" | "friends" | "blocked";

// ───────────────────────────── Presencia ─────────────────────────────

export type PresenceStatus = "offline" | "online" | "in_menu" | "in_queue" | "in_match" | "observing" | "away";

export interface Presence {
  userId: UserId;
  status: PresenceStatus;
  activity: string;          // texto libre ("En el menú", "Buscando partida", …)
  mode: string | null;       // modo de juego (competitive/casual/…)
  region: Region;
  partyId: string | null;
  isLeader: boolean;
  matchId: string | null;
  connectedAt: number;       // reloj lógico de conexión
  updatedAt: number;
  rich: string;              // Rich Presence (preparado)
}

// ───────────────────────────── Party ─────────────────────────────

export type PartyPrivacy = "open" | "closed" | "invite_only";
export type PartyState = "idle" | "queuing" | "in_lobby" | "in_match";

export interface PartyMember { id: UserId; name: string; ready: boolean; joinedAt: number; region: Region }

export interface PartySettings { privacy: PartyPrivacy; maxSize: number; crossRegion: boolean; mode: string }

export interface ChatMessage { id: string; from: UserId; text: string; at: number }

export interface Party {
  id: string;
  leaderId: UserId;
  members: PartyMember[];
  settings: PartySettings;
  region: Region;
  chat: ChatMessage[];
  state: PartyState;
  createdAt: number;
}

// ───────────────────────────── Invitaciones ─────────────────────────────

export type InviteKind = "friend" | "party" | "lobby" | "spectator";
export type InviteState = "pending" | "accepted" | "declined" | "cancelled" | "expired";

export interface Invitation {
  id: string;
  kind: InviteKind;
  from: UserId;
  to: UserId;
  refId: string | null;      // partyId/lobbyId/matchId según el tipo
  createdAt: number;
  expiresAt: number;
  state: InviteState;
}

// ───────────────────────────── Notificaciones ─────────────────────────────

export type NotificationType =
  | "friend_request" | "friend_accept" | "party_invite" | "party_joined" | "party_left"
  | "party_kicked" | "leader_transfer" | "invite_expired" | "presence";

export interface Notification { id: string; type: NotificationType; to: UserId; from: UserId | null; text: string; at: number; read: boolean }

// ───────────────────────────── Recientes / privacidad ─────────────────────────────

export interface RecentPlayer { id: UserId; name: string; lastAt: number; games: number }

export type PrivacyScope = "everyone" | "friends" | "none";
export interface PrivacySettings { allowFriendRequests: boolean; allowPartyInvites: PrivacyScope; showPresence: PrivacyScope }

export interface SocialEvent { type: string; at: number; data?: unknown }
