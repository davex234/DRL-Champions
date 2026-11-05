/**
 * PARTY ENGINE — grupos de 1..5 (Online Fase 4/7).
 *
 * Crear/unirse/salir/expulsar/transferir-líder/ready/settings/chat/snapshot. INVARIANTES:
 * un único líder (nunca dos), sin miembros duplicados, un usuario en UNA sola party (anti doble
 * party), capacidad respetada. Reconexión = leer la party persistida. Voice hooks = solo infra.
 * PURO respecto al reloj. Determinista (ids por contador + seed).
 */
import type { Region } from "@/domain/cards/types";
import type { UserId, Party, PartySettings, PartyState, ChatMessage } from "./types";

interface UserRef { id: UserId; name: string; region: Region }

export class PartyEngine {
  private parties = new Map<string, Party>();
  private userParty = new Map<UserId, string>();
  private counter = 0;
  private seedBase: number;
  constructor(seedBase = 1) { this.seedBase = seedBase; }

  get(id: string): Party | undefined { return this.parties.get(id); }
  partyOf(userId: UserId): Party | null { const id = this.userParty.get(userId); return id ? this.parties.get(id) ?? null : null; }
  size(): number { return this.parties.size; }

  create(leader: UserRef, settings: Partial<PartySettings>, now: number): Party {
    if (this.userParty.has(leader.id)) this.leave(leader.id, now);
    const id = `party-${this.seedBase}-${this.counter++}`;
    const s: PartySettings = { privacy: "invite_only", maxSize: 5, crossRegion: true, mode: "casual", ...settings };
    const party: Party = { id, leaderId: leader.id, members: [{ id: leader.id, name: leader.name, ready: false, joinedAt: now, region: leader.region }], settings: s, region: leader.region, chat: [], state: "idle", createdAt: now };
    this.parties.set(id, party); this.userParty.set(leader.id, id);
    return party;
  }

  join(partyId: string, member: UserRef, now: number): { ok: boolean; error?: string; party?: Party } {
    const p = this.parties.get(partyId); if (!p) return { ok: false, error: "no-party" };
    if (this.userParty.get(member.id) === partyId) return { ok: true, party: p };          // idempotente
    if (this.userParty.has(member.id)) return { ok: false, error: "already-in-party" };     // anti doble party
    if (p.members.length >= p.settings.maxSize) return { ok: false, error: "full" };
    if (p.state !== "idle") return { ok: false, error: "party-busy" };
    if (!p.settings.crossRegion && member.region !== p.region) return { ok: false, error: "region-locked" };
    p.members.push({ id: member.id, name: member.name, ready: false, joinedAt: now, region: member.region });
    this.userParty.set(member.id, partyId);
    return { ok: true, party: p };
  }

  leave(userId: UserId, now: number): { party: Party | null; dissolved: boolean } {
    const id = this.userParty.get(userId); if (!id) return { party: null, dissolved: false };
    const p = this.parties.get(id)!;
    p.members = p.members.filter((m) => m.id !== userId);
    this.userParty.delete(userId);
    if (p.members.length === 0) { this.parties.delete(id); return { party: null, dissolved: true }; }
    if (p.leaderId === userId) p.leaderId = p.members[0].id;   // transferencia automática (nunca sin líder)
    return { party: p, dissolved: false };
  }

  kick(partyId: string, byLeader: UserId, target: UserId): { ok: boolean; error?: string } {
    const p = this.parties.get(partyId); if (!p) return { ok: false, error: "no-party" };
    if (p.leaderId !== byLeader) return { ok: false, error: "not-leader" };
    if (target === byLeader) return { ok: false, error: "cant-kick-self" };
    if (!p.members.some((m) => m.id === target)) return { ok: false, error: "not-member" };
    p.members = p.members.filter((m) => m.id !== target); this.userParty.delete(target);
    return { ok: true };
  }

  transferLeader(partyId: string, byLeader: UserId, target: UserId): { ok: boolean; error?: string } {
    const p = this.parties.get(partyId); if (!p) return { ok: false, error: "no-party" };
    if (p.leaderId !== byLeader) return { ok: false, error: "not-leader" };
    if (!p.members.some((m) => m.id === target)) return { ok: false, error: "not-member" };
    p.leaderId = target;   // leaderId ÚNICO ⇒ nunca dos líderes
    return { ok: true };
  }

  setReady(partyId: string, userId: UserId, ready: boolean): void { const m = this.parties.get(partyId)?.members.find((x) => x.id === userId); if (m) m.ready = ready; }
  allReady(partyId: string): boolean { const p = this.parties.get(partyId); return !!p && p.members.length > 0 && p.members.every((m) => m.ready); }
  setSettings(partyId: string, byLeader: UserId, patch: Partial<PartySettings>): { ok: boolean; error?: string } { const p = this.parties.get(partyId); if (!p) return { ok: false, error: "no-party" }; if (p.leaderId !== byLeader) return { ok: false, error: "not-leader" }; p.settings = { ...p.settings, ...patch }; return { ok: true }; }
  setState(partyId: string, state: PartyState): void { const p = this.parties.get(partyId); if (p) p.state = state; }

  chat(partyId: string, from: UserId, text: string, now: number): ChatMessage | null {
    const p = this.parties.get(partyId); if (!p || !p.members.some((m) => m.id === from)) return null;
    const msg: ChatMessage = { id: `msg-${p.id}-${p.chat.length}`, from, text, at: now };
    p.chat = [...p.chat, msg].slice(-100);
    return msg;
  }

  snapshot(partyId: string): Party | null { const p = this.parties.get(partyId); return p ? JSON.parse(JSON.stringify(p)) as Party : null; }
}

/** Voice chat hooks — SOLO infraestructura (sin audio real). Preparado para Fase futura. */
export interface VoiceHooks { onJoin(partyId: string, userId: UserId): void; onLeave(partyId: string, userId: UserId): void; onMute(userId: UserId, muted: boolean): void }
export const noopVoice: VoiceHooks = { onJoin() {}, onLeave() {}, onMute() {} };
