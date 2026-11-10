/**
 * LEADERBOARD ENGINE — clasificaciones INCREMENTALES y BUCKETED (Online Fase 3/7).
 *
 * Indexa por banda de MMR (bucket) para consultar rango sin O(n²) ni re-ordenar todo. Global,
 * regional, coach, club, temporada, histórico. Preparado para millones (upsert O(banda)). PURO.
 */
import type { Region } from "@/domain/cards/types";
import type { LeaderboardEntry, LeaderboardScope } from "./types";

const BAND = 25;

export class Leaderboard {
  readonly scope: LeaderboardScope;
  readonly region: Region | null;
  private entries = new Map<string, LeaderboardEntry>();
  private buckets = new Map<number, Set<string>>();   // bandIdx → ids

  constructor(scope: LeaderboardScope, region: Region | null = null) { this.scope = scope; this.region = region; }

  private bandOf(mmr: number): number { return Math.floor(mmr / BAND); }

  upsert(e: LeaderboardEntry): void {
    const prev = this.entries.get(e.id);
    if (prev) { const b = this.buckets.get(this.bandOf(prev.mmr)); b?.delete(e.id); }
    this.entries.set(e.id, e);
    const band = this.bandOf(e.mmr);
    let set = this.buckets.get(band); if (!set) { set = new Set(); this.buckets.set(band, set); }
    set.add(e.id);
  }

  remove(id: string): void {
    const e = this.entries.get(id); if (!e) return;
    this.buckets.get(this.bandOf(e.mmr))?.delete(id);
    this.entries.delete(id);
  }

  /** Rango 1-based (nº de jugadores con MÁS MMR + 1). O(nº bandas + banda propia). */
  rankOf(id: string): number {
    const e = this.entries.get(id); if (!e) return -1;
    const myBand = this.bandOf(e.mmr);
    let higher = 0;
    for (const [band, set] of this.buckets) {
      if (band > myBand) higher += set.size;
      else if (band === myBand) for (const oid of set) { const o = this.entries.get(oid)!; if (o.mmr > e.mmr || (o.mmr === e.mmr && o.id < e.id)) higher++; }
    }
    return higher + 1;
  }

  /** Top-N descendente. Recorre solo las bandas más altas necesarias. */
  top(n: number): LeaderboardEntry[] {
    const bands = [...this.buckets.keys()].sort((a, b) => b - a);
    const out: LeaderboardEntry[] = [];
    for (const band of bands) {
      const slice = [...this.buckets.get(band)!].map((id) => this.entries.get(id)!).sort((a, b) => b.mmr - a.mmr || (a.id < b.id ? -1 : 1));
      for (const e of slice) { out.push(e); if (out.length >= n) return out; }
    }
    return out;
  }

  size(): number { return this.entries.size; }
  get(id: string): LeaderboardEntry | undefined { return this.entries.get(id); }
}
