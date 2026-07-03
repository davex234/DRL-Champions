/**
 * SOCIAL PRESENTATION — vistas listas para pintar (Online Fase 4/7).
 * El motor prepara; la UI pinta. PURO.
 */
import type { UserId, FriendState, PresenceStatus, Party, Notification } from "./types";
import type { SocialEngine } from "./engine";

export interface FriendView { id: UserId; state: FriendState; favorite: boolean; status: PresenceStatus | "unknown"; rich: string }
export interface PartyView { id: string; leaderId: UserId; size: number; maxSize: number; state: Party["state"]; allReady: boolean; members: { id: UserId; name: string; ready: boolean; isLeader: boolean; status: PresenceStatus | "unknown" }[]; privacy: Party["settings"]["privacy"] }

export function friendsListView(engine: SocialEngine, userId: UserId): FriendView[] {
  const favs = new Set(engine.friends.favoritesOf(userId));
  return engine.friends.friendsOf(userId).map((id): FriendView => {
    const pr = engine.presenceOf(userId, id);
    const status: PresenceStatus | "unknown" = pr?.status ?? "unknown";
    return { id, state: engine.friends.state(userId, id), favorite: favs.has(id), status, rich: pr?.rich ?? "Desconectado" };
  }).sort((a, b) => (Number(b.favorite) - Number(a.favorite)) || (rank(a.status) - rank(b.status)));
}

function rank(s: PresenceStatus | "unknown"): number { return s === "offline" || s === "unknown" ? 9 : 0; }

export function partyView(engine: SocialEngine, partyId: string): PartyView | null {
  const p = engine.parties.get(partyId); if (!p) return null;
  return {
    id: p.id, leaderId: p.leaderId, size: p.members.length, maxSize: p.settings.maxSize, state: p.state,
    allReady: engine.parties.allReady(partyId), privacy: p.settings.privacy,
    members: p.members.map((m): PartyView["members"][number] => ({ id: m.id, name: m.name, ready: m.ready, isLeader: m.id === p.leaderId, status: engine.presence.get(m.id)?.status ?? "unknown" })),
  };
}

export function notificationsView(engine: SocialEngine, userId: UserId): { unread: number; items: Notification[] } {
  return { unread: engine.notifs.unread(userId), items: engine.notifs.all(userId).slice(0, 20) };
}
