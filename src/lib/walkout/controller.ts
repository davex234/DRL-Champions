/**
 * PACK WALKOUT · EL CONTROLADOR — un solo reloj para toda la escena.
 *
 * Un `requestAnimationFrame` (inyectable: los tests usan uno falso) avanza el tiempo; cada fotograma calcula
 * `frameAt(t)` y lo entrega a quien pinta. Cada beat que se cruza dispara su «cue» (sonido) UNA vez.
 *
 *   play()    arranca desde el principio (o continúa si estaba en pausa).
 *   skip()    salta al estado final: un último fotograma con todo revelado, sin más cues y sin reloj activo.
 *   reset()   vuelve al instante 0 (nada activo).
 *   seek(t)   congela un instante (QA por beats), sin reloj.
 *   dispose() corta el reloj y suelta a los oyentes: después no se dispara nada.
 *
 * No hay temporizadores sueltos: si el controlador está parado, no queda NADA programado.
 */
import { beatsCrossed, frameAt, type BeatId, type WalkoutFrame, type WalkoutTimeline } from "@/domain/walkout/timeline";

export interface FrameScheduler {
  request: (cb: (now: number) => void) => number;
  cancel: (id: number) => void;
}

export const browserScheduler = (): FrameScheduler => ({
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
});

export interface WalkoutListeners {
  onFrame?: (f: WalkoutFrame) => void;
  onCue?: (beat: BeatId) => void;
  onDone?: () => void;
}

export type ControllerState = "idle" | "playing" | "done" | "disposed";

export class WalkoutController {
  private raf: number | null = null;
  private startedAt = 0;
  private t = 0;
  private state: ControllerState = "idle";

  constructor(private tl: WalkoutTimeline, private listeners: WalkoutListeners, private scheduler: FrameScheduler = browserScheduler()) {}

  get status(): ControllerState { return this.state; }
  get time(): number { return this.t; }
  /** ¿Queda un fotograma programado? (los tests comprueban que no tras skip/dispose). */
  get pending(): boolean { return this.raf !== null; }

  /**
   * `from` (s, 0.5): empezar DESDE un instante (en la apertura real el sobre ya se rasgó en su propia escena: el walkout
   * entra por el apagón). Los cues anteriores a `from` no suenan.
   */
  play(from = 0): void {
    if (this.state === "disposed") return;
    this.stop();
    this.state = "playing";
    const t0 = Math.max(0, Math.min(this.tl.duration, from));
    this.t = t0;
    this.listeners.onFrame?.(frameAt(this.tl, t0));
    this.raf = this.scheduler.request((now) => { this.startedAt = now - t0 * 1000; this.tick(now); });
  }

  private tick(now: number): void {
    this.raf = null;
    if (this.state !== "playing") return;
    const prev = this.t;
    const next = Math.min(this.tl.duration, (now - this.startedAt) / 1000);
    this.t = next;
    for (const b of beatsCrossed(this.tl, prev, next)) this.listeners.onCue?.(b);
    const f = frameAt(this.tl, next);
    this.listeners.onFrame?.(f);
    if (f.done) { this.state = "done"; this.listeners.onDone?.(); return; }
    this.raf = this.scheduler.request((n) => this.tick(n));
  }

  /** Al estado final: un fotograma completo, sin cues pendientes y sin reloj. */
  skip(): void {
    if (this.state === "disposed") return;
    this.stop();
    this.t = this.tl.duration;
    this.state = "done";
    this.listeners.onFrame?.(frameAt(this.tl, this.tl.duration));
    this.listeners.onDone?.();
  }

  /** Congela la escena en el instante `t` (revisión visual por beats): un fotograma, sin reloj ni cues. */
  seek(t: number): void {
    if (this.state === "disposed") return;
    this.stop();
    const f = frameAt(this.tl, t);
    this.t = f.t;
    this.state = f.done ? "done" : "idle";
    this.listeners.onFrame?.(f);
  }

  reset(): void {
    if (this.state === "disposed") return;
    this.stop();
    this.t = 0;
    this.state = "idle";
    this.listeners.onFrame?.(frameAt(this.tl, 0));
  }

  dispose(): void {
    this.stop();
    this.state = "disposed";
    this.listeners = {};
  }

  private stop(): void {
    if (this.raf !== null) { this.scheduler.cancel(this.raf); this.raf = null; }
  }
}
