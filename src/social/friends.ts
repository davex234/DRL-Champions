/**
 * FRIEND ENGINE — grafo social (Online Fase 4/7).
 *
 * Solicitudes, aceptar/rechazar, eliminar, bloquear, favoritos. Grafo NO dirigido en `Map`
 * (O(1) por operación, sin O(n²)). Anti-duplicados, bloqueos aplicados, auto-amistad si existe
 * solicitud recíproca. PURO respecto al reloj (el `now` se inyecta). Determinista.
 */
import type { UserId, FriendState } from "./types";

interface Link { since: number; favorite: boolean }

export class FriendGraph {
  private friends = new Map<UserId, Map<UserId, Link>>();
  private outgoing = new Map<UserId, Set<UserId>>();  // from → destinos pendientes
  private blocked = new Map<UserId, Set<UserId>>();    // from → bloqueados

  private ensure<T>(m: Map<UserId, T>, k: UserId, make: () => T): T { let v = m.get(k); if (!v) { v = make(); m.set(k, v); } return v; }

  isBlocked(a: UserId, b: UserId): boolean { return !!this.blocked.get(a)?.has(b); }
  isFriend(a: UserId, b: UserId): boolean { return !!this.friends.get(a)?.has(b); }

  /** Envía solicitud. Devuelve el estado resultante o un error (anti-duplicado / bloqueo). */
  request(from: UserId, to: UserId, now: number): { ok: boolean; error?: string; friended?: boolean } {
    if (from === to) return { ok: false, error: "self" };
    if (this.isBlocked(to, from) || this.isBlocked(from, to)) return { ok: false, error: "blocked" };
    if (this.isFriend(from, to)) return { ok: false, error: "already-friends" };
    if (this.outgoing.get(from)?.has(to)) return { ok: false, error: "already-requested" };
    // Solicitud recíproca ⇒ amistad automática.
    if (this.outgoing.get(to)?.has(from)) { this.outgoing.get(to)!.delete(from); this.link(from, to, now); return { ok: true, friended: true }; }
    this.ensure(this.outgoing, from, () => new Set()).add(to);
    return { ok: true };
  }

  accept(user: UserId, from: UserId, now: number): { ok: boolean; error?: string } {
    if (!this.outgoing.get(from)?.has(user)) return { ok: false, error: "no-request" };
    this.outgoing.get(from)!.delete(user);
    this.link(user, from, now);
    return { ok: true };
  }
  decline(user: UserId, from: UserId): void { this.outgoing.get(from)?.delete(user); }
  cancelRequest(from: UserId, to: UserId): void { this.outgoing.get(from)?.delete(to); }

  remove(a: UserId, b: UserId): void { this.friends.get(a)?.delete(b); this.friends.get(b)?.delete(a); }

  block(from: UserId, target: UserId): void {
    this.ensure(this.blocked, from, () => new Set()).add(target);
    this.remove(from, target);
    this.outgoing.get(from)?.delete(target);
    this.outgoing.get(target)?.delete(from);
  }
  unblock(from: UserId, target: UserId): void { this.blocked.get(from)?.delete(target); }

  favorite(user: UserId, friend: UserId, fav: boolean): void { const l = this.friends.get(user)?.get(friend); if (l) l.favorite = fav; }

  private link(a: UserId, b: UserId, now: number): void {
    this.ensure(this.friends, a, () => new Map()).set(b, { since: now, favorite: false });
    this.ensure(this.friends, b, () => new Map()).set(a, { since: now, favorite: false });
  }

  state(a: UserId, b: UserId): FriendState {
    if (this.isBlocked(a, b)) return "blocked";
    if (this.isFriend(a, b)) return "friends";
    if (this.outgoing.get(a)?.has(b)) return "requested";
    if (this.outgoing.get(b)?.has(a)) return "incoming";
    return "none";
  }
  friendsOf(user: UserId): UserId[] { return [...(this.friends.get(user)?.keys() ?? [])]; }
  favoritesOf(user: UserId): UserId[] { return [...(this.friends.get(user)?.entries() ?? [])].filter(([, l]) => l.favorite).map(([id]) => id); }
  incoming(user: UserId): UserId[] { const out: UserId[] = []; for (const [from, set] of this.outgoing) if (set.has(user)) out.push(from); return out; }
  outgoingOf(user: UserId): UserId[] { return [...(this.outgoing.get(user) ?? [])]; }
  blockedBy(user: UserId): UserId[] { return [...(this.blocked.get(user) ?? [])]; }
}
