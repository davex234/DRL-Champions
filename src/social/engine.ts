/**
 * SOCIAL ENGINE — el orquestador del ÚNICO flujo social (Online Fase 4/7).
 *
 *   Friend → Party → Lobby → Matchmaking → Online Session → Gameplay
 *
 * Compone friends + presence + party + invitations + notifications + privacy + recent, aplica la
 * SEGURIDAD (bloqueos, privacidad, anti-duplicado, anti-spam) y hace de PUENTE con el Matchmaking
 * (una party entra en cola como GRUPO). Reutiliza Identity/Matchmaking/Competitive; no crea otro
 * Lobby/Match/Session/Profile. DETERMINISTA (reloj lógico `now` inyectado por el llamador).
 */
import type { Region } from "@/domain/cards/types";
import { Matchmaker, profileFrom, type QueueMode, type PlayerProfile } from "@/matchmaking";
import type { UserId, Party, PartySettings, PrivacySettings, Presence, Notification, ChatMessage, SocialEvent, NotificationType } from "./types";
import { FriendGraph } from "./friends";
import { PresenceEngine } from "./presence";
import { PartyEngine } from "./party";
import { InvitationEngine } from "./invitations";
import { NotificationEngine } from "./notifications";
import { RecentPlayers } from "./recent";
import { DEFAULT_PRIVACY, canReceiveFriendRequest, canReceivePartyInvite, canSeePresence } from "./privacy";

export class SocialEngine {
  now = 0;
  readonly friends = new FriendGraph();
  readonly presence = new PresenceEngine();
  readonly parties: PartyEngine;
  readonly invites: InvitationEngine;
  readonly notifs = new NotificationEngine();
  readonly recent = new RecentPlayers();
  private privacy = new Map<UserId, PrivacySettings>();
  private users = new Map<UserId, { name: string; region: Region }>();
  events: SocialEvent[] = [];

  constructor(seedBase = 1) { this.parties = new PartyEngine(seedBase); this.invites = new InvitationEngine(seedBase); }

  register(id: UserId, name: string, region: Region = "EMEA"): void { this.users.set(id, { name, region }); this.presence.ensure(id, region, this.now); if (!this.privacy.has(id)) this.privacy.set(id, { ...DEFAULT_PRIVACY }); }
  private priv(id: UserId): PrivacySettings { return this.privacy.get(id) ?? DEFAULT_PRIVACY; }
  setPrivacy(id: UserId, patch: Partial<PrivacySettings>): void { this.privacy.set(id, { ...this.priv(id), ...patch }); }
  private nameOf(id: UserId): string { return this.users.get(id)?.name ?? id; }
  private regionOf(id: UserId): Region { return this.users.get(id)?.region ?? "EMEA"; }
  private notify(to: UserId, type: NotificationType, from: UserId | null, text: string): void { const n = this.notifs.push(to, type, from, text, this.now); if (n) this.events.push({ type: "notification", at: this.now, data: n }); }

  // ── Amigos ──
  sendFriendRequest(from: UserId, to: UserId): { ok: boolean; error?: string } {
    if (this.friends.isBlocked(to, from)) return { ok: false, error: "blocked" };
    if (!canReceiveFriendRequest(this.priv(to))) return { ok: false, error: "privacy" };
    const r = this.friends.request(from, to, this.now);
    if (!r.ok) return { ok: false, error: r.error };
    if (r.friended) { this.notify(from, "friend_accept", to, `${this.nameOf(to)} ahora es tu amigo`); this.notify(to, "friend_accept", from, `${this.nameOf(from)} ahora es tu amigo`); }
    else this.notify(to, "friend_request", from, `${this.nameOf(from)} te envió una solicitud`);
    return { ok: true };
  }
  acceptFriend(user: UserId, from: UserId): { ok: boolean; error?: string } { const r = this.friends.accept(user, from, this.now); if (r.ok) this.notify(from, "friend_accept", user, `${this.nameOf(user)} aceptó tu solicitud`); return r; }
  declineFriend(user: UserId, from: UserId): void { this.friends.decline(user, from); }
  removeFriend(a: UserId, b: UserId): void { this.friends.remove(a, b); }
  block(from: UserId, target: UserId): void { this.friends.block(from, target); if (this.parties.partyOf(target)?.id === this.parties.partyOf(from)?.id && this.parties.partyOf(from)) this.leaveParty(target); }
  unblock(from: UserId, target: UserId): void { this.friends.unblock(from, target); }
  favorite(user: UserId, friend: UserId, fav: boolean): void { this.friends.favorite(user, friend, fav); }

  // ── Party ──
  private updatePresenceForParty(p: Party): void { for (const m of p.members) this.presence.set(m.id, { partyId: p.id, isLeader: m.id === p.leaderId, region: this.regionOf(m.id) }, this.now); }

  createParty(leaderId: UserId, settings: Partial<PartySettings> = {}): Party { const p = this.parties.create({ id: leaderId, name: this.nameOf(leaderId), region: this.regionOf(leaderId) }, settings, this.now); this.updatePresenceForParty(p); return p; }

  invitePartyMember(from: UserId, to: UserId, partyId: string): { ok: boolean; error?: string } {
    const p = this.parties.get(partyId); if (!p) return { ok: false, error: "no-party" };
    if (p.leaderId !== from && p.settings.privacy === "closed") return { ok: false, error: "not-leader" };
    if (this.friends.isBlocked(to, from)) return { ok: false, error: "blocked" };
    if (!canReceivePartyInvite(this.priv(to), this.friends.isFriend(from, to))) return { ok: false, error: "privacy" };
    const r = this.invites.create("party", from, to, partyId, this.now, 60);
    if (!r.invite) return { ok: false, error: r.error };
    this.notify(to, "party_invite", from, `${this.nameOf(from)} te invitó a su party`);
    return { ok: true };
  }
  acceptPartyInvite(inviteId: string): { ok: boolean; error?: string; party?: Party } {
    const inv = this.invites.accept(inviteId, this.now);
    if (!inv || inv.kind !== "party" || !inv.refId) return { ok: false, error: "invalid" };
    const j = this.parties.join(inv.refId, { id: inv.to, name: this.nameOf(inv.to), region: this.regionOf(inv.to) }, this.now);
    if (!j.ok) return { ok: false, error: j.error };
    this.notify(inv.from, "party_joined", inv.to, `${this.nameOf(inv.to)} se unió a la party`);
    this.updatePresenceForParty(j.party!);
    return { ok: true, party: j.party };
  }
  joinOpenParty(userId: UserId, partyId: string): { ok: boolean; error?: string } { const p = this.parties.get(partyId); if (!p) return { ok: false, error: "no-party" }; if (p.settings.privacy !== "open") return { ok: false, error: "not-open" }; const j = this.parties.join(partyId, { id: userId, name: this.nameOf(userId), region: this.regionOf(userId) }, this.now); if (j.ok && j.party) this.updatePresenceForParty(j.party); return { ok: j.ok, error: j.error }; }
  leaveParty(userId: UserId): void { const r = this.parties.leave(userId, this.now); this.presence.set(userId, { partyId: null, isLeader: false }, this.now); if (r.party) { this.notify(r.party.leaderId, "party_left", userId, `${this.nameOf(userId)} salió de la party`); this.updatePresenceForParty(r.party); } }
  kickMember(partyId: string, byLeader: UserId, target: UserId): { ok: boolean; error?: string } { const r = this.parties.kick(partyId, byLeader, target); if (r.ok) { this.presence.set(target, { partyId: null, isLeader: false }, this.now); this.notify(target, "party_kicked", byLeader, "Fuiste expulsado de la party"); const p = this.parties.get(partyId); if (p) this.updatePresenceForParty(p); } return r; }
  transferLeader(partyId: string, byLeader: UserId, target: UserId): { ok: boolean; error?: string } { const r = this.parties.transferLeader(partyId, byLeader, target); if (r.ok) { const p = this.parties.get(partyId)!; this.notify(target, "leader_transfer", byLeader, "Eres el nuevo líder de la party"); this.updatePresenceForParty(p); } return r; }
  setReady(partyId: string, userId: UserId, ready: boolean): void { this.parties.setReady(partyId, userId, ready); }
  partyChat(partyId: string, from: UserId, text: string): ChatMessage | null { return this.parties.chat(partyId, from, text, this.now); }
  setPartySettings(partyId: string, byLeader: UserId, patch: Partial<PartySettings>): { ok: boolean; error?: string } { return this.parties.setSettings(partyId, byLeader, patch); }
  /** Reconexión de party: el estado persiste ⇒ reconectar = leer la party del usuario. */
  reconnectParty(userId: UserId): Party | null { return this.parties.partyOf(userId); }

  // ── Presencia ──
  goOnline(userId: UserId): Presence { return this.presence.setStatus(userId, "online", this.now); }
  goOffline(userId: UserId): void { const p = this.parties.partyOf(userId); if (p) this.parties.setReady(p.id, userId, false); this.presence.goOffline(userId, this.now); }   // offline friend: la party persiste
  /** Presencia visible para `viewer` (respeta privacidad). */
  presenceOf(viewer: UserId, target: UserId): Presence | null { const p = this.presence.get(target); if (!p) return null; if (viewer !== target && !canSeePresence(this.priv(target), this.friends.isFriend(viewer, target))) return null; return p; }

  // ── Invitaciones caducables ──
  tick(now: number): void { this.now = now; for (const inv of this.invites.tick(now)) this.notify(inv.to, "invite_expired", inv.from, "Una invitación caducó"); }

  // ── PUENTE con Matchmaking (flujo único: Party → Matchmaking) ──
  queueParty(matchmaker: Matchmaker, partyId: string, mode: QueueMode, mmrOf: (id: UserId) => number): { ticketId?: string; error?: string } {
    const p = this.parties.get(partyId); if (!p) return { error: "no-party" };
    if (!this.parties.allReady(partyId)) return { error: "not-ready" };
    const avgMmr = Math.round(p.members.reduce((a, m) => a + mmrOf(m.id), 0) / p.members.length);
    const profile: PlayerProfile = profileFrom(p.leaderId, this.nameOf(p.leaderId), { region: p.region, mmr: avgMmr });
    profile.partyId = partyId;                       // la party entra como GRUPO
    const r = matchmaker.enqueue(profile, mode);
    if (r.error) return { error: r.error };
    this.parties.setState(partyId, "queuing");
    for (const m of p.members) this.presence.enterQueue(m.id, mode, this.now);
    return { ticketId: r.ticket!.id };
  }

  /** Al lanzarse la partida de la party → todos en match + recientes registrados. */
  onMatchLaunched(partyId: string, matchId: string, mode: string): void {
    const p = this.parties.get(partyId); if (!p) return;
    this.parties.setState(partyId, "in_match");
    for (const m of p.members) this.presence.enterMatch(m.id, matchId, mode, this.now);
    for (const a of p.members) for (const b of p.members) if (a.id !== b.id) this.recent.record(a.id, b.id, b.name, this.now);
  }
  /** Registra jugadores con los que se compartió partida (recientes) — compat Matchmaking/Online. */
  recordMatchTogether(players: { id: UserId; name: string }[]): void { for (const a of players) for (const b of players) if (a.id !== b.id) this.recent.record(a.id, b.id, b.name, this.now); }

  userExists(id: UserId): boolean { return this.users.has(id); }
}
