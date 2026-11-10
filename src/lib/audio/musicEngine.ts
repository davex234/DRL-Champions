"use client";

/**
 * FASE 44.1 · MOTOR DE MÚSICA — el ÚNICO gestor de música del juego (un bus, un tema activo).
 *
 * Reutiliza el contexto de audio de `lib/sound` (nunca crea otro) y sintetiza los temas de `music.ts` con un
 * planificador de anticipación (cada 250 ms programa los compases del próximo ~1,2 s). Garantías:
 *   · no arranca sin gesto (`unlockMusic` se llama desde el primer pointerdown/keydown/touchstart);
 *   · como mucho 2 capas vivas (la que entra y la que sale); la saliente se funde y se desconecta;
 *   · pestaña oculta → bus a 0 en 600 ms y no se programa nada; al volver, retoma desde «ahora» (sin ráfagas);
 *   · duck (sobre, stinger) con contador, así que dos fuentes a la vez no se pisan.
 */
import { audioContextFromGesture, getAudioSettings, musicGain, onAudioSettingsChange, runningAudioContext } from "@/lib/sound";
import {
  barEvents, barSeconds, crossfadeMs, INITIAL_MUSIC, midiToHz, MUSIC_THEMES, musicPlan, musicReducer,
  type MusicContext, type MusicEvent, type MusicState, type NoteEvent,
} from "./music";

interface Layer { context: MusicContext; gain: GainNode; filter: BiquadFilterNode; bar: number; nextAt: number; stopAt: number | null }

export const MAX_LAYERS = 2;
const LOOKAHEAD_S = 1.2;
const TICK_MS = 250;

let state: MusicState = INITIAL_MUSIC;
let bus: GainNode | null = null;
let layers: Layer[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let unsubscribe: (() => void) | null = null;
let voices = 0;

function dispatch(e: MusicEvent) {
  const prevHidden = state.hidden;
  state = musicReducer(state, e);
  apply(prevHidden !== state.hidden ? 600 : 350);
}

function apply(rampMs: number) {
  const ac = state.unlocked ? runningAudioContext() : null;
  if (!ac) return;
  if (!bus) { bus = ac.createGain(); bus.gain.value = 0; bus.connect(ac.destination); }
  const plan = musicPlan(state);
  bus.gain.cancelScheduledValues(ac.currentTime);
  bus.gain.setTargetAtTime(plan.gain, ac.currentTime, rampMs / 3000);

  const current = layers.find((l) => l.stopAt === null) ?? null;
  if ((current?.context ?? null) === plan.context) return;
  const ms = crossfadeMs(current?.context ?? null, plan.context);
  if (current) {
    current.gain.gain.cancelScheduledValues(ac.currentTime);
    current.gain.gain.setValueAtTime(current.gain.gain.value, ac.currentTime);
    current.gain.gain.linearRampToValueAtTime(0, ac.currentTime + ms / 1000);
    current.stopAt = ac.currentTime + ms / 1000;
  }
  if (plan.context) {
    const theme = MUSIC_THEMES[plan.context];
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, ac.currentTime);
    gain.gain.linearRampToValueAtTime(theme.level, ac.currentTime + ms / 1000);
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = theme.cutoff;
    filter.Q.value = 0.4;
    filter.connect(gain).connect(bus);
    layers.push({ context: plan.context, gain, filter, bar: 0, nextAt: ac.currentTime + 0.08, stopAt: null });
  }
  // Nunca más de MAX_LAYERS: si alguien cambia de sala muy deprisa, las capas más viejas se cortan ya.
  while (layers.length > MAX_LAYERS) retire(layers.shift()!);
  if (!timer) {
    timer = setInterval(tick, TICK_MS);
    // En Node (pruebas) el intervalo no debe retener el proceso; en el navegador no existe `unref`.
    (timer as unknown as { unref?: () => void }).unref?.();
  }
}

function retire(l: Layer) {
  try { l.gain.disconnect(); l.filter.disconnect(); } catch { /* ya desconectada */ }
}

function tick() {
  const ac = runningAudioContext();
  if (!ac) return;
  const now = ac.currentTime;
  layers = layers.filter((l) => {
    if (l.stopAt !== null && now > l.stopAt + 0.3) { retire(l); return false; }
    return true;
  });
  if (layers.length === 0) { if (timer) { clearInterval(timer); timer = null; } return; }
  if (state.hidden || musicPlan(state).gain === 0) return;
  for (const l of layers) {
    if (l.stopAt !== null) continue;
    const theme = MUSIC_THEMES[l.context];
    if (l.nextAt < now - 0.1) l.nextAt = now + 0.05; // vuelta de pestaña oculta: sin ráfaga de compases atrasados
    let guard = 0;
    while (l.nextAt < now + LOOKAHEAD_S && guard++ < 4) {
      for (const n of barEvents(theme, l.bar)) voice(ac, l, n, l.nextAt, theme.pad);
      l.nextAt += barSeconds(theme);
      l.bar++;
    }
  }
}

function voice(ac: AudioContext, l: Layer, n: NoteEvent, barAt: number, pad: OscillatorType) {
  const t0 = barAt + n.at;
  const f = midiToHz(n.midi);
  const env = ac.createGain();
  env.connect(l.filter);
  const oscs: OscillatorNode[] = [];
  const add = (type: OscillatorType, freq: number, detune = 0) => {
    const o = ac.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t0); o.detune.value = detune;
    o.connect(env); oscs.push(o);
    return o;
  };
  let end = t0 + n.dur;
  switch (n.voice) {
    case "pad":
      add(pad, f, -6); add(pad, f, 6);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.045, t0 + Math.min(0.6, n.dur / 3));
      env.gain.setValueAtTime(0.045, end - 0.4);
      env.gain.linearRampToValueAtTime(0.0001, end + 0.4);
      end += 0.45;
      break;
    case "bass":
      add("sine", f);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.08, t0 + 0.05);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      break;
    case "pulse": {
      const o = add("sine", Math.max(60, f * 2));
      o.frequency.exponentialRampToValueAtTime(40, t0 + n.dur);
      env.gain.setValueAtTime(0.1, t0);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      break;
    }
    case "arp":
      add("triangle", f);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.03, t0 + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      break;
  }
  let alive = oscs.length;
  for (const o of oscs) {
    voices++;
    o.start(t0);
    o.stop(end + 0.05);
    o.onended = () => {
      voices--; alive--;
      try { o.disconnect(); } catch { /* ya desconectado */ }
      if (alive <= 0) { try { env.disconnect(); } catch { /* ya desconectado */ } }
    };
  }
}

/* ───────────── API ───────────── */

/** Primer gesto del jugador: crea/reanuda el contexto y deja sonar la música del contexto actual. */
export function unlockMusic(): void {
  if (!audioContextFromGesture()) return;
  if (!unsubscribe) unsubscribe = onAudioSettingsChange((s) => dispatch({ type: "volume", value: musicGain(s) }));
  state = musicReducer(state, { type: "volume", value: musicGain(getAudioSettings()) });
  // El contexto puede tardar un instante en pasar a «running» tras resume().
  const go = () => dispatch({ type: "unlock" });
  if (runningAudioContext()) go(); else setTimeout(go, 60);
}

export const setMusicRoute = (context: MusicContext | null): void => dispatch({ type: "route", context });
export const setMusicHidden = (hidden: boolean): void => dispatch({ type: "visibility", hidden });

/** Una pantalla fuerza su contexto (resultado) mientras está montada. Devuelve la liberación. */
export function pushMusicOverride(context: MusicContext): () => void {
  dispatch({ type: "override", context });
  let done = false;
  return () => { if (done) return; done = true; if (state.override === context) dispatch({ type: "override", context: null }); };
}

/** Agacha la música (apertura de sobre). Devuelve la liberación; idempotente. */
export function duckMusic(): () => void {
  dispatch({ type: "duck", on: true });
  let done = false;
  return () => { if (done) return; done = true; dispatch({ type: "duck", on: false }); };
}

/** Agacha la música un rato fijo (stinger de victoria/derrota). */
export function stingDuck(ms = 2600): void {
  const release = duckMusic();
  setTimeout(release, Math.max(500, Math.min(6000, ms)));
}

/** Un paso del planificador a mano (pruebas con reloj falso; en la app lo llama el intervalo). */
export const musicTick = (): void => tick();

/** Foto de depuración para el arnés y la QA en navegador (sin datos del jugador). */
export function musicDebug() {
  return { state, plan: musicPlan(state), layers: layers.map((l) => ({ context: l.context, stopping: l.stopAt !== null })), voices, ticking: timer !== null };
}
