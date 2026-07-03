"use client";

/**
 * Sonidos sintetizados con la Web Audio API (sin archivos de audio).
 * Permite efectos de corte, explosión y revelado según la rareza.
 */

let ctx: AudioContext | null = null;
let muted = false;

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setMuted(m: boolean) {
  muted = m;
}
export function isMuted() {
  return muted;
}

function tone(
  freq: number,
  start: number,
  duration: number,
  type: OscillatorType,
  gain: number,
  endFreq?: number,
) {
  const ac = audioCtx();
  if (!ac || muted) return;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + duration);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

function noise(start: number, duration: number, gain: number) {
  const ac = audioCtx();
  if (!ac || muted) return;
  const t0 = ac.currentTime + start;
  const buffer = ac.createBuffer(1, ac.sampleRate * duration, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  const filter = ac.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1200;
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(t0);
}

/** Activa el contexto de audio tras un gesto del usuario (autoplay policy). */
export function primeAudio() {
  audioCtx();
}

/** Sonido continuo de corte/rasgado (llamar repetidamente al deslizar). */
export function playCutTick() {
  noise(0, 0.05, 0.08);
}

/** Explosión de apertura del sobre. */
export function playBurst() {
  noise(0, 0.4, 0.25);
  tone(180, 0, 0.5, "sawtooth", 0.18, 60);
  tone(520, 0.02, 0.4, "triangle", 0.12, 1200);
}

/** Sonido de revelado según el nivel de rareza (rank). */
export function playReveal(rank: number) {
  if (rank <= 2) {
    tone(440, 0, 0.18, "sine", 0.1, 560);
  } else if (rank <= 5) {
    tone(523, 0, 0.22, "triangle", 0.12, 784);
  } else if (rank <= 8) {
    tone(523, 0, 0.25, "triangle", 0.14, 880);
    tone(784, 0.08, 0.3, "sine", 0.1, 1046);
  } else if (rank <= 11) {
    // Épica: acorde ascendente
    [523, 659, 784].forEach((f, i) => tone(f, i * 0.07, 0.4, "triangle", 0.12, f * 1.2));
  } else {
    // Legendaria/Icon: fanfarria
    [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.08, 0.6, "sawtooth", 0.1, f * 1.3));
    noise(0, 0.6, 0.12);
  }
}

// ---------------------------------------------------------------------------
// CUES DE RETRANSMISIÓN — stingers cortos para los momentos del partido.
// Sintetizados (sin assets). Se disparan desde la capa de presentación.
// ---------------------------------------------------------------------------
export type BroadcastCue =
  | "first_blood" | "kill" | "ace" | "clutch" | "plant" | "defuse"
  | "round_win" | "round_lose" | "match_point" | "victory" | "defeat"
  | "ui" | "whoosh";

/** Dispara un cue de retransmisión. No hace nada si está silenciado. */
export function playCue(cue: BroadcastCue) {
  switch (cue) {
    case "first_blood":
      tone(740, 0, 0.12, "square", 0.07, 540); noise(0, 0.08, 0.05); break;
    case "kill":
      tone(420, 0, 0.06, "square", 0.04, 300); break;
    case "ace":
      [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.07, 0.45, "sawtooth", 0.09, f * 1.25));
      noise(0, 0.5, 0.1); break;
    case "clutch":
      tone(196, 0, 0.5, "sawtooth", 0.12, 392); tone(294, 0.1, 0.5, "triangle", 0.08, 588); break;
    case "plant":
      tone(330, 0, 0.1, "square", 0.08); tone(330, 0.18, 0.1, "square", 0.08); break;
    case "defuse":
      tone(660, 0, 0.18, "sine", 0.08, 990); break;
    case "round_win":
      [523, 784].forEach((f, i) => tone(f, i * 0.09, 0.25, "triangle", 0.1, f * 1.2)); break;
    case "round_lose":
      [392, 294].forEach((f, i) => tone(f, i * 0.1, 0.3, "sine", 0.08, f * 0.85)); break;
    case "match_point":
      [523, 659, 784].forEach((f, i) => tone(f, i * 0.12, 0.4, "sawtooth", 0.1, f * 1.1));
      noise(0, 0.3, 0.06); break;
    case "victory":
      [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.11, 0.7, "sawtooth", 0.11, f * 1.3));
      noise(0, 0.7, 0.12); break;
    case "defeat":
      [440, 349, 262].forEach((f, i) => tone(f, i * 0.16, 0.6, "sine", 0.09, f * 0.8)); break;
    case "ui":
      tone(880, 0, 0.04, "triangle", 0.05, 1100); break;
    case "whoosh":
      noise(0, 0.25, 0.06); tone(200, 0, 0.25, "sine", 0.05, 600); break;
  }
}
