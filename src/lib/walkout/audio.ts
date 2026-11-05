/**
 * PACK WALKOUT · AUDIO — sonidos SINTETIZADOS (WebAudio), sin ficheros ni licencias de terceros.
 *
 * Usa el mismo contexto y las mismas preferencias que el resto del juego (`lib/sound`: volumen general × efectos,
 * silencio). Sin gesto previo del usuario no suena nada (el navegador lo bloquea y aquí no se fuerza). Cada cue es un
 * marcador de posición propio, pensado para sustituirse por diseño sonoro definitivo sin tocar la escena.
 *
 * Todo lo programado se apunta en `live`: `stopAll()` lo corta (SALTAR, REPETIR, desmontar) — nada suena después.
 */
import type { BeatId } from "@/domain/walkout/timeline";
import { effectiveGain, runningAudioContext } from "@/lib/sound";

export type WalkoutCue = "ambient" | "packOpen" | "footsteps" | "flagDrop" | "roleReveal" | "teamImpact" | "ratingTick" | "revealHit" | "finalSting"
  | "arena" | "celebrate";

/** 0.3 · forma del rumor del público: [segundos desde que empieza, ganancia relativa]. */
export type CrowdEnvelope = readonly (readonly [number, number])[];

/** Qué cue suena al empezar cada beat (los beats sin cue no suenan). */
export const CUE_OF_BEAT: Partial<Record<BeatId, WalkoutCue>> = {
  lights: "arena", open: "packOpen", human: "footsteps", flag: "flagDrop", role: "roleReveal", team: "teamImpact",
  celebrate: "celebrate", ovrFirst: "ratingTick", ovrFull: "ratingTick", flash: "revealHit", card: "finalSting",
};

export class WalkoutAudio {
  private live = new Set<AudioScheduledSourceNode>();
  private enabled = true;

  constructor(private ctxProvider: () => AudioContext | null = runningAudioContext) {}

  setEnabled(on: boolean): void { this.enabled = on; if (!on) this.stopAll(); }
  get isEnabled(): boolean { return this.enabled; }

  stopAll(): void {
    for (const n of this.live) { try { n.stop(); } catch { /* ya parado */ } }
    this.live.clear();
  }

  /**
   * 0.5 · NUNCA lanza: un audio roto (contexto que falla, nodo que no se crea, permiso denegado) deja la escena en
   * silencio y la apertura sigue — el cue se llama desde el reloj de la animación y un error ahí la congelaría.
   */
  play(cue: WalkoutCue, opts: { intensity?: number; steps?: number; stepEvery?: number; stepTimes?: readonly number[]; crowd?: CrowdEnvelope; celebration?: string; landAt?: number } = {}): void {
    try { this.playUnsafe(cue, opts); } catch { this.failed = true; }
  }

  /** ¿Falló el audio alguna vez en esta escena? (QA; la escena siguió igual). */
  failed = false;

  private playUnsafe(cue: WalkoutCue, opts: { intensity?: number; steps?: number; stepEvery?: number; stepTimes?: readonly number[]; crowd?: CrowdEnvelope; celebration?: string; landAt?: number }): void {
    if (!this.enabled) return;
    const ac = this.ctxProvider();
    const gain = effectiveGain();
    if (!ac || gain <= 0) return;
    const k = gain * (0.55 + 0.45 * (opts.intensity ?? 0.6));
    const t0 = ac.currentTime + 0.01;
    switch (cue) {
      case "ambient": this.drone(ac, t0, 6, 55, 0.05 * k); break;
      case "packOpen": this.noise(ac, t0, 0.45, 0.16 * k, 400, 4200); break;
      case "footsteps": {
        // 0.2: los pasos caen cuando el pie apoya (`footfalls`); sin lista, el metrónomo de 0.1
        const times = opts.stepTimes ?? Array.from({ length: opts.steps ?? 8 }, (_, i) => i * (opts.stepEvery ?? 0.5));
        times.forEach((at, i) => this.thump(ac, t0 + at, 70, 0.09 * k * (0.6 + 0.4 * (i / times.length))));
        break;
      }
      case "flagDrop": this.noise(ac, t0, 0.35, 0.12 * k, 900, 2400); this.thump(ac, t0 + 0.32, 90, 0.18 * k); break;
      case "roleReveal": this.tone(ac, t0, 0.5, 660, 0.06 * k, "triangle"); this.tone(ac, t0 + 0.06, 0.45, 990, 0.04 * k, "sine"); break;
      case "teamImpact": this.thump(ac, t0, 48, 0.38 * k, 0.6); this.noise(ac, t0, 0.18, 0.14 * k, 150, 900); break;
      case "ratingTick": this.tone(ac, t0, 0.12, 1320, 0.07 * k, "square"); this.thump(ac, t0, 120, 0.12 * k, 0.15); break;
      case "revealHit": this.thump(ac, t0, 40, 0.45 * k, 0.9); this.noise(ac, t0, 0.5, 0.18 * k, 200, 7000); break;
      case "finalSting": for (const [i, f] of [220, 277.2, 329.6, 440].entries()) this.tone(ac, t0 + i * 0.03, 1.6, f, 0.035 * k, "sawtooth"); break;
      // 0.3 · la arena: zumbido grave, las pantallas que se encienden (barrido digital + chasquidos) y el público
      case "arena": {
        this.drone(ac, t0, 8, 55, 0.05 * k);
        this.sweep(ac, t0 + 0.05, 0.9, 180, 1400, 0.025 * k);
        for (let i = 0; i < 6; i++) this.tone(ac, t0 + 0.15 + i * 0.14, 0.05, 2400 - i * 160, 0.018 * k, "square");
        this.crowd(ac, t0, opts.crowd ?? [[0, 0.5], [1.5, 1], [9, 1], [10, 0]], 0.05 * k);
        break;
      }
      case "celebrate": {
        if (opts.celebration === "SHUSH") this.noise(ac, t0 + 0.45, 0.8, 0.07 * k, 4200, 6500);                 // «shhh»
        else { this.noise(ac, t0, 0.6, 0.06 * k, 300, 1800); }
        if (opts.celebration === "HYPE_JUMP" && opts.landAt) this.thump(ac, t0 + opts.landAt, 55, 0.3 * k, 0.4);    // aterrizaje
        break;
      }
    }
  }

  private track<T extends AudioScheduledSourceNode>(n: T): T { this.live.add(n); n.onended = () => this.live.delete(n); return n; }

  private envGain(ac: AudioContext, t0: number, dur: number, peak: number): GainNode {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(ac.destination);
    return g;
  }

  private tone(ac: AudioContext, t0: number, dur: number, freq: number, peak: number, type: OscillatorType): void {
    const o = this.track(ac.createOscillator());
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    o.connect(this.envGain(ac, t0, dur, peak));
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  /** Golpe grave: seno que cae de tono (bombo / impacto). */
  private thump(ac: AudioContext, t0: number, freq: number, peak: number, dur = 0.25): void {
    const o = this.track(ac.createOscillator());
    o.type = "sine"; o.frequency.setValueAtTime(freq * 2.2, t0); o.frequency.exponentialRampToValueAtTime(freq, t0 + dur * 0.4);
    o.connect(this.envGain(ac, t0, dur, peak));
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  private drone(ac: AudioContext, t0: number, dur: number, freq: number, peak: number): void {
    const o = this.track(ac.createOscillator());
    o.type = "sawtooth"; o.frequency.setValueAtTime(freq, t0);
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(220, t0);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + 1.2); g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(lp); lp.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  /** Barrido de tono (pantallas que se encienden). */
  private sweep(ac: AudioContext, t0: number, dur: number, from: number, to: number, peak: number): void {
    const o = this.track(ac.createOscillator());
    o.type = "triangle"; o.frequency.setValueAtTime(from, t0); o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    o.connect(this.envGain(ac, t0, dur, peak));
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  /**
   * Rumor de público: ruido rosa aproximado, filtrado en la banda de las voces, con un vaivén lento y la ganancia que
   * marca la escena (crece con el escudo, calla con el SHUSH, ruge al aterrizar el salto). Sintetizado: ni grabaciones ni
   * retransmisiones.
   */
  private crowd(ac: AudioContext, t0: number, env: CrowdEnvelope, peak: number): void {
    const dur = Math.max(1, env[env.length - 1]?.[0] ?? 8);
    const len = Math.floor(ac.sampleRate * Math.min(4, dur));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let s = 987654321, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff; const w = (s / 0x7fffffff) * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048;
      d[i] = (b0 + b1 + b2 + w * 0.02) * (0.75 + 0.25 * Math.sin((i / ac.sampleRate) * 2.3));
    }
    const src = this.track(ac.createBufferSource()); src.buffer = buf; src.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.setValueAtTime(700, t0); bp.Q.setValueAtTime(0.6, t0);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t0);
    for (const [at, v] of env) g.gain.linearRampToValueAtTime(Math.max(0.0001, v * peak), t0 + at);
    src.connect(bp); bp.connect(g); g.connect(ac.destination);
    src.start(t0); src.stop(t0 + dur + 0.1);
  }

  /** Ráfaga de ruido filtrado (apertura, aire de la caída). Ruido determinista: no es azar de juego, solo textura. */
  private noise(ac: AudioContext, t0: number, dur: number, peak: number, fromHz: number, toHz: number): void {
    const len = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let s = 1234567;
    for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x7fffffff) * 2 - 1; }
    const src = this.track(ac.createBufferSource());
    src.buffer = buf;
    const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.setValueAtTime(fromHz, t0); bp.frequency.exponentialRampToValueAtTime(toHz, t0 + dur);
    src.connect(bp); bp.connect(this.envGain(ac, t0, dur, peak));
    src.start(t0); src.stop(t0 + dur + 0.05);
  }
}
