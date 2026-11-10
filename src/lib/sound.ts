"use client";

/**
 * Sonidos sintetizados con la Web Audio API (sin archivos de audio).
 * Permite efectos de corte, explosión y revelado según la rareza.
 */

import { createRateGate, HOVER_SOUND_MIN_MS } from "@/lib/audio/music";

let ctx: AudioContext | null = null;
let muted = false;

/*
 * FASE 44 · AJUSTES DE AUDIO. Volumen general y de efectos (0..1) y silencio, guardados SOLO en este dispositivo
 * (`localStorage`, sin cuenta ni migración). Se leen una vez de forma perezosa; si el navegador bloquea el almacenamiento,
 * se usan los valores por defecto y el juego suena igual. Ningún sonido antes de un gesto: el contexto de audio solo
 * existe tras `primeAudio()` o la primera llamada desde un evento del jugador (política de autoplay).
 */
/*
 * FASE 44.1 · MÚSICA Y EFECTOS POR SEPARADO: volumen propio (0..1) y silencio propio para cada uno, además del general.
 * Misma clave de almacenamiento: lo guardado en Fase 44 (sin `music`) se lee con los valores por defecto nuevos.
 */
export interface AudioSettings { master: number; sfx: number; muted: boolean; music: number; musicMuted: boolean; sfxMuted: boolean }
export const AUDIO_STORAGE_KEY = "nexus:audio:v1";
export const DEFAULT_AUDIO: AudioSettings = { master: 0.8, sfx: 0.8, muted: false, music: 0.5, musicMuted: false, sfxMuted: false };
let settings: AudioSettings | null = null;

const clampVol = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

/** Normaliza lo que haya guardado (o basura) a ajustes válidos. Pura; exportada para las pruebas. */
export function parseAudioSettings(raw: string | null): AudioSettings {
  if (!raw) return { ...DEFAULT_AUDIO };
  try {
    const o = JSON.parse(raw) as Partial<AudioSettings>;
    if (!o || typeof o !== "object") return { ...DEFAULT_AUDIO };
    return {
      master: clampVol(o.master, DEFAULT_AUDIO.master), sfx: clampVol(o.sfx, DEFAULT_AUDIO.sfx), muted: o.muted === true,
      music: clampVol(o.music, DEFAULT_AUDIO.music), musicMuted: o.musicMuted === true, sfxMuted: o.sfxMuted === true,
    };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

export function getAudioSettings(): AudioSettings {
  if (settings) return settings;
  let raw: string | null = null;
  try { raw = typeof window !== "undefined" ? window.localStorage.getItem(AUDIO_STORAGE_KEY) : null; } catch { raw = null; }
  settings = parseAudioSettings(raw);
  muted = settings.muted;
  return settings;
}

export function setAudioSettings(next: Partial<AudioSettings>): AudioSettings {
  const cur = getAudioSettings();
  settings = {
    master: clampVol(next.master ?? cur.master, cur.master), sfx: clampVol(next.sfx ?? cur.sfx, cur.sfx), muted: next.muted ?? cur.muted,
    music: clampVol(next.music ?? cur.music, cur.music), musicMuted: next.musicMuted ?? cur.musicMuted, sfxMuted: next.sfxMuted ?? cur.sfxMuted,
  };
  muted = settings.muted;
  try { window.localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(settings)); } catch { /* sin almacenamiento: solo esta sesión */ }
  for (const fn of listeners) fn(settings);
  return settings;
}

const listeners = new Set<(s: AudioSettings) => void>();
/** Avisa de cada cambio de ajustes (el motor de música ajusta su bus). Devuelve la baja. */
export function onAudioSettingsChange(fn: (s: AudioSettings) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

type GainSettings = Pick<AudioSettings, "master" | "sfx" | "muted"> & Partial<AudioSettings>;

/** Ganancia efectiva de EFECTOS: general × efectos (0 si está todo silenciado o los efectos lo están). */
export function effectiveGain(s: GainSettings = getAudioSettings()): number {
  return s.muted || s.sfxMuted === true ? 0 : s.master * s.sfx;
}

/** Ganancia efectiva de MÚSICA: general × música (0 si está todo silenciado o la música lo está). */
export function musicGain(s: GainSettings = getAudioSettings()): number {
  return s.muted || s.musicMuted === true ? 0 : s.master * (s.music ?? DEFAULT_AUDIO.music);
}

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
  if (typeof window !== "undefined") setAudioSettings({ muted: m });
}
export function isMuted() {
  if (typeof window !== "undefined") getAudioSettings();
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
  const k = effectiveGain();
  if (!ac || muted || k <= 0) return;
  gain = Math.max(0.00011, gain * k);
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
  const k = effectiveGain();
  if (!ac || muted || k <= 0) return;
  gain = Math.max(0.00011, gain * k);
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

/** FASE 44.1 · el contexto compartido, creado/reanudado. Llamar SOLO desde un gesto del jugador. */
export function audioContextFromGesture(): AudioContext | null {
  return audioCtx();
}

/** El contexto solo si ya existe y está sonando (nunca lo crea: sirve para sonidos que no nacen de un gesto). */
export function runningAudioContext(): AudioContext | null {
  return ctx && ctx.state === "running" ? ctx : null;
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

// ---------------------------------------------------------------------------
// FASE 44 · EVENTOS DE SONIDO CON NOMBRE — arquitectura mínima sobre los mismos sintetizadores (sin ficheros de audio,
// sin descargas: todo se genera aquí). Las pantallas piden un EVENTO, no un tono: cambiar un sonido es cambiar una línea.
// ---------------------------------------------------------------------------
export type SoundEvent =
  | "ui.hover" | "ui.confirm" | "ui.back" | "ui.error"
  | "play.hover" | "play.confirm"
  | "pack.select" | "pack.open"
  | "card.reveal" | "card.rare" | "card.epic" | "card.legendary" | "serial.one"
  | "match.turn" | "turn.win" | "turn.loss" | "turn.tie" | "match.win" | "match.loss" | "match.draw"
  | "level.up" | "mission.complete" | "achievement.unlock"
  // FASE 61 · el ritmo de la partida: el VS, el equipo que salta a la mesa, el eje que se revela y cada paso del desempate.
  | "match.vs" | "match.lineup" | "stat.reveal" | "tiebreak.step"
  // FASE 64 · respuesta global: acción que salió bien, cambio de sección y rival encontrado.
  | "ui.success" | "ui.nav" | "match.found";

/*
 * FASE 44.1 · catálogo completo. `hover` = sonido de paso: como mucho uno cada `HOVER_SOUND_MIN_MS` y nunca crea el
 * contexto de audio (sin un gesto previo, callado). Todo sintetizado aquí.
 */
export const SOUND_EVENTS: Record<SoundEvent, { level: 1 | 2 | 3 | 4; hover?: boolean; play: () => void }> = {
  "ui.hover": { level: 1, hover: true, play: () => tone(1320, 0, 0.03, "sine", 0.025, 1500) },
  "ui.confirm": { level: 1, play: () => playCue("ui") },
  "ui.back": { level: 1, play: () => tone(900, 0, 0.06, "triangle", 0.045, 620) },
  "ui.error": { level: 2, play: () => { tone(220, 0, 0.12, "square", 0.045, 180); tone(196, 0.1, 0.16, "square", 0.04, 150); } },
  "play.hover": { level: 1, hover: true, play: () => { tone(660, 0, 0.06, "triangle", 0.03, 990); tone(1320, 0.02, 0.05, "sine", 0.018); } },
  "play.confirm": { level: 2, play: () => { tone(330, 0, 0.18, "sawtooth", 0.07, 660); tone(660, 0.05, 0.22, "triangle", 0.08, 1320); noise(0, 0.12, 0.04); } },
  "pack.select": { level: 1, play: () => { tone(520, 0, 0.08, "triangle", 0.05, 780); noise(0, 0.05, 0.02); } },
  "pack.open": { level: 3, play: () => playBurst() },
  "card.reveal": { level: 2, play: () => playReveal(2) },
  "card.rare": { level: 3, play: () => playReveal(6) },
  "card.epic": { level: 3, play: () => playReveal(10) },
  "card.legendary": { level: 4, play: () => playReveal(12) },
  "serial.one": { level: 4, play: () => { playReveal(12); [1568, 2093].forEach((f, i) => tone(f, 0.45 + i * 0.1, 0.5, "sine", 0.06, f * 1.05)); } },
  "match.turn": { level: 1, play: () => tone(740, 0, 0.07, "triangle", 0.04, 880) },
  // FASE 45 · el turno resuelto suena distinto al desenlace de la partida: corto y sin fanfarria.
  "turn.win": { level: 2, play: () => playCue("round_win") },
  "turn.loss": { level: 2, play: () => playCue("round_lose") },
  "turn.tie": { level: 2, play: () => { tone(523, 0, 0.16, "triangle", 0.06, 523); tone(523, 0.12, 0.2, "sine", 0.05, 494); } },
  "match.win": { level: 3, play: () => playCue("victory") },
  "match.loss": { level: 3, play: () => playCue("defeat") },
  "match.draw": { level: 3, play: () => [523, 587, 523].forEach((f, i) => tone(f, i * 0.14, 0.4, "triangle", 0.08, f)) },
  "level.up": { level: 3, play: () => [659, 880, 1175].forEach((f, i) => tone(f, i * 0.09, 0.35, "triangle", 0.1, f * 1.12)) },
  "mission.complete": { level: 2, play: () => [784, 1046].forEach((f, i) => tone(f, i * 0.08, 0.25, "triangle", 0.08, f * 1.1)) },
  "achievement.unlock": { level: 3, play: () => { [523, 784, 1046, 1568].forEach((f, i) => tone(f, i * 0.07, 0.45, "triangle", 0.08, f * 1.08)); noise(0.2, 0.3, 0.04); } },
  // FASE 61 · cortos y graves: acompañan, no celebran (la fanfarria es del desenlace).
  "match.vs": { level: 2, play: () => { noise(0, 0.18, 0.05); tone(110, 0, 0.35, "sawtooth", 0.07, 55); tone(220, 0.04, 0.3, "triangle", 0.05, 330); } },
  "match.lineup": { level: 1, play: () => [392, 523, 659].forEach((f, i) => tone(f, i * 0.06, 0.12, "triangle", 0.04, f * 1.05)) },
  "stat.reveal": { level: 2, play: () => { tone(587, 0, 0.1, "square", 0.035, 880); tone(880, 0.07, 0.14, "triangle", 0.045, 880); } },
  "tiebreak.step": { level: 2, play: () => { tone(330, 0, 0.2, "triangle", 0.06, 494); noise(0, 0.08, 0.03); } },
  // FASE 64 · discretos: confirman sin celebrar (la celebración es de recompensas, nivel y partida).
  "ui.success": { level: 1, play: () => { tone(880, 0, 0.08, "triangle", 0.045, 988); tone(1318, 0.06, 0.12, "sine", 0.035, 1318); } },
  "ui.nav": { level: 1, play: () => tone(1046, 0, 0.035, "sine", 0.02, 1175) },
  "match.found": { level: 2, play: () => { [440, 660, 880].forEach((f, i) => tone(f, i * 0.07, 0.18, "triangle", 0.06, f * 1.02)); noise(0, 0.06, 0.02); } },
};

const hoverGate = createRateGate(HOVER_SOUND_MIN_MS);

/** Reproduce un evento de sonido. Silencioso sin gesto previo, silenciado o con volumen 0; los de paso, limitados. */
export function playSound(ev: SoundEvent): void {
  const e = SOUND_EVENTS[ev];
  if (!e) return;
  if (e.hover && (!runningAudioContext() || !hoverGate(typeof performance !== "undefined" ? performance.now() : Date.now()))) return;
  e.play();
}
