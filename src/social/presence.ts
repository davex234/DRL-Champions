/**
 * PRESENCE ENGINE — estado/actividad de cada usuario (Online Fase 4/7).
 *
 * Online/offline/en-partida/en-cola/observando + modo/región/party/líder/match. Rich Presence
 * preparado. PURO respecto al reloj. Determinista.
 */
import type { Region } from "@/domain/cards/types";
import type { UserId, Presence, PresenceStatus } from "./types";

const STATUS_LABEL: Record<PresenceStatus, string> = {
  offline: "Desconectado", online: "Conectado", in_menu: "En el menú", in_queue: "Buscando partida",
  in_match: "En partida", observing: "Observando", away: "Ausente",
};

export class PresenceEngine {
  private map = new Map<UserId, Presence>();

  ensure(userId: UserId, region: Region = "EMEA", now = 0): Presence {
    let p = this.map.get(userId);
    if (!p) { p = { userId, status: "offline", activity: STATUS_LABEL.offline, mode: null, region, partyId: null, isLeader: false, matchId: null, connectedAt: now, updatedAt: now, rich: STATUS_LABEL.offline }; this.map.set(userId, p); }
    return p;
  }

  get(userId: UserId): Presence | undefined { return this.map.get(userId); }
  isOnline(userId: UserId): boolean { const p = this.map.get(userId); return !!p && p.status !== "offline"; }

  set(userId: UserId, patch: Partial<Presence>, now: number): Presence {
    const prev = this.ensure(userId, patch.region, now);
    const wasOffline = prev.status === "offline";
    const next: Presence = { ...prev, ...patch, updatedAt: now };
    if (wasOffline && next.status !== "offline") next.connectedAt = now;
    next.rich = richPresence(next);
    this.map.set(userId, next);
    return next;
  }

  setStatus(userId: UserId, status: PresenceStatus, now: number): Presence { return this.set(userId, { status, activity: STATUS_LABEL[status] }, now); }
  enterQueue(userId: UserId, mode: string, now: number): Presence { return this.set(userId, { status: "in_queue", mode, activity: `Buscando partida (${mode})` }, now); }
  enterMatch(userId: UserId, matchId: string, mode: string, now: number): Presence { return this.set(userId, { status: "in_match", matchId, mode, activity: `En partida (${mode})` }, now); }
  goOffline(userId: UserId, now: number): Presence { return this.set(userId, { status: "offline", matchId: null, mode: null, partyId: null, isLeader: false, activity: STATUS_LABEL.offline }, now); }

  connectedTicks(userId: UserId, now: number): number { const p = this.map.get(userId); return p && p.status !== "offline" ? now - p.connectedAt : 0; }
}

/** Rich Presence combinando estado + modo + party (preparado). */
export function richPresence(p: Presence): string {
  const base = STATUS_LABEL[p.status];
  const parts = [base];
  if (p.mode && (p.status === "in_match" || p.status === "in_queue")) parts.push(p.mode);
  if (p.partyId) parts.push(p.isLeader ? "Party (líder)" : "En party");
  return parts.join(" · ");
}
