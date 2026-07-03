/**
 * REPLAY TIMELINE — la línea temporal del replay (Online Fase 5/7).
 *
 * Reconstruye el partido UNA vez (reutiliza `reconstruct`) y expone rondas, eventos, highlights
 * (reutiliza `extractHighlights` de Broadcast) y bookmarks. Timeline COMPRIMIDA: los datos base
 * son el input log; los estados se derivan bajo demanda. PURO/DETERMINISTA.
 */
import type { MatchState } from "@/match";
import type { SimEvent } from "@/sim";
import { reconstruct } from "@/online";
import { extractHighlights, type HighlightClip } from "@/broadcast";
import type { Replay, RoundBoundary, Bookmark } from "./types";

export class ReplayTimeline {
  readonly replay: Replay;
  private boundaries: RoundBoundary[];
  private full: MatchState;

  constructor(replay: Replay) {
    this.replay = replay;
    this.full = reconstruct(replay.config, replay.log);
    this.boundaries = this.full.rounds.map((r, i) => ({ round: i, seed: r.seed, ticks: r.tick, winner: r.winner, endReason: r.endReason }));
  }

  roundCount(): number { return this.boundaries.length; }
  totalTicks(): number { return this.boundaries.reduce((a, b) => a + b.ticks, 0); }
  bounds(): RoundBoundary[] { return this.boundaries; }
  eventsInRound(round: number): SimEvent[] { return this.full.rounds[round]?.events ?? []; }
  highlights(): HighlightClip[] { return extractHighlights(this.full); }
  finalState(): MatchState { return this.full; }

  addBookmark(round: number, tick: number, label: string, at: number): Bookmark {
    const b: Bookmark = { id: `bm-${this.replay.bookmarks.length}`, round, tick, label, at };
    this.replay.bookmarks.push(b);
    return b;
  }
  removeBookmark(id: string): void { this.replay.bookmarks = this.replay.bookmarks.filter((b) => b.id !== id); }
  bookmarks(): Bookmark[] { return this.replay.bookmarks; }
}
