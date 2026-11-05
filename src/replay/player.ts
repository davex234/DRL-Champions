/**
 * REPLAY PLAYER / VIEWER — playback determinista (Online Fase 5/7).
 *
 * Pause/Resume/Seek/Frame Step/Speed sobre la timeline. Reconstruye los estados tick-a-tick de
 * cada ronda BAJO DEMANDA (memoizados por ronda ⇒ seek dentro de una ronda es O(1); sin duplicar
 * snapshots). El `RoundState` que devuelve es el MISMO dato que consume el Spectator. DETERMINISTA.
 */
import type { RoundState } from "@/sim";
import { reconstructRoundStates } from "./engine";
import { ReplayTimeline } from "./timeline";
import type { Replay, ReplayPosition } from "./types";

export class ReplayPlayer {
  readonly replay: Replay;
  readonly timeline: ReplayTimeline;
  playing = false;
  speed = 1;
  pos: ReplayPosition = { round: 0, tick: 0 };
  private cache = new Map<number, RoundState[]>();

  constructor(replay: Replay) { this.replay = replay; this.timeline = new ReplayTimeline(replay); }

  private states(round: number): RoundState[] {
    let s = this.cache.get(round);
    if (!s) { s = reconstructRoundStates(this.replay.config, this.replay.log, round); this.cache.set(round, s); }
    return s;
  }
  private roundLen(round: number): number { return this.states(round).length; }

  current(): RoundState | null { const s = this.states(this.pos.round); return s[Math.min(this.pos.tick, s.length - 1)] ?? null; }

  play(): void { this.playing = true; }
  pause(): void { this.playing = false; }
  resume(): void { this.playing = true; }
  setSpeed(sp: number): void { this.speed = Math.max(0.1, sp); }

  seek(round: number, tick: number): RoundState | null {
    const R = Math.max(0, Math.min(this.timeline.roundCount() - 1, round));
    const T = Math.max(0, Math.min(this.roundLen(R) - 1, tick));
    this.pos = { round: R, tick: T };
    return this.current();
  }
  seekBookmark(id: string): RoundState | null { const b = this.replay.bookmarks.find((x) => x.id === id); return b ? this.seek(b.round, b.tick) : null; }

  frameStep(delta: number): RoundState | null { return this.stepTicks(delta); }
  atEnd(): boolean { return this.pos.round >= this.timeline.roundCount() - 1 && this.pos.tick >= this.roundLen(this.pos.round) - 1; }
  atStart(): boolean { return this.pos.round === 0 && this.pos.tick === 0; }

  private stepTicks(n: number): RoundState | null {
    let { round, tick } = this.pos;
    let remaining = Math.trunc(n);
    while (remaining !== 0) {
      if (remaining > 0) {
        if (tick + 1 < this.roundLen(round)) { tick++; remaining--; }
        else if (round + 1 < this.timeline.roundCount()) { round++; tick = 0; remaining--; }
        else break;
      } else {
        if (tick > 0) { tick--; remaining++; }
        else if (round > 0) { round--; tick = this.roundLen(round) - 1; remaining++; }
        else break;
      }
    }
    this.pos = { round, tick };
    return this.current();
  }

  /** Avanza el playback si está reproduciendo (speed ticks). Devuelve el frame actual. */
  advance(): RoundState | null {
    if (!this.playing) return this.current();
    const r = this.stepTicks(Math.max(1, Math.round(this.speed)));
    if (this.atEnd()) this.playing = false;
    return r;
  }
}
