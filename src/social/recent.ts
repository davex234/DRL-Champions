/**
 * RECENT PLAYERS — con quién jugaste últimamente (Online Fase 4/7). Capado y deduplicado. PURO.
 */
import type { UserId, RecentPlayer } from "./types";

export class RecentPlayers {
  private byUser = new Map<UserId, RecentPlayer[]>();

  record(user: UserId, other: UserId, name: string, now: number): void {
    if (user === other) return;
    const arr = this.byUser.get(user) ?? [];
    const ex = arr.find((r) => r.id === other);
    if (ex) { ex.lastAt = now; ex.games++; } else arr.push({ id: other, name, lastAt: now, games: 1 });
    this.byUser.set(user, arr.sort((a, b) => b.lastAt - a.lastAt).slice(0, 50));
  }

  list(user: UserId): RecentPlayer[] { return this.byUser.get(user) ?? []; }
}
