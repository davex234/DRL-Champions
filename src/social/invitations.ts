/**
 * INVITATION ENGINE — amigo/party/lobby/spectator, expirables (Online Fase 4/7).
 *
 * Crear/aceptar/rechazar/cancelar/timeout. Anti-duplicado (una pendiente por from/to/kind). PURO
 * respecto al reloj. Determinista.
 */
import type { UserId, Invitation, InviteKind } from "./types";

export class InvitationEngine {
  private inv = new Map<string, Invitation>();
  private counter = 0;
  private seedBase: number;
  constructor(seedBase = 1) { this.seedBase = seedBase; }

  get(id: string): Invitation | undefined { return this.inv.get(id); }

  create(kind: InviteKind, from: UserId, to: UserId, refId: string | null, now: number, ttl: number): { invite?: Invitation; error?: string } {
    if (from === to) return { error: "self" };
    for (const i of this.inv.values()) if (i.state === "pending" && i.from === from && i.to === to && i.kind === kind) return { error: "duplicate" }; // anti-spam/duplicado
    const invite: Invitation = { id: `inv-${this.seedBase}-${this.counter++}`, kind, from, to, refId, createdAt: now, expiresAt: now + ttl, state: "pending" };
    this.inv.set(invite.id, invite);
    return { invite };
  }

  accept(id: string, now: number): Invitation | null { const i = this.inv.get(id); if (!i || i.state !== "pending" || now >= i.expiresAt) return null; i.state = "accepted"; return i; }
  decline(id: string): void { const i = this.inv.get(id); if (i?.state === "pending") i.state = "declined"; }
  cancel(from: UserId, id: string): void { const i = this.inv.get(id); if (i?.state === "pending" && i.from === from) i.state = "cancelled"; }

  /** Expira las pendientes vencidas. Devuelve las expiradas. */
  tick(now: number): Invitation[] {
    const expired: Invitation[] = [];
    for (const i of this.inv.values()) if (i.state === "pending" && now >= i.expiresAt) { i.state = "expired"; expired.push(i); }
    return expired;
  }

  forUser(to: UserId): Invitation[] { return [...this.inv.values()].filter((i) => i.to === to && i.state === "pending"); }
  fromUser(from: UserId): Invitation[] { return [...this.inv.values()].filter((i) => i.from === from && i.state === "pending"); }
}
