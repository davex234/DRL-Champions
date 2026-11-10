/**
 * FASE 44.1 · MOTOR DE MÚSICA Y EFECTOS contra un Web Audio FALSO (sin navegador): un único contexto, nada antes del
 * gesto, fundido con como mucho dos capas, pestaña oculta sin programar, duck, override de resultado y efectos que
 * respetan los silencios independientes. El reloj de audio lo avanza la prueba.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";

/* ───────────── Web Audio falso ───────────── */

class Param {
  value = 0; events: [string, number][] = [];
  setValueAtTime(v: number) { this.value = v; this.events.push(["set", v]); return this; }
  linearRampToValueAtTime(v: number) { this.value = v; this.events.push(["lin", v]); return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; this.events.push(["exp", v]); return this; }
  setTargetAtTime(v: number) { this.value = v; this.events.push(["target", v]); return this; }
  cancelScheduledValues() { return this; }
}
class Node {
  connected = 0; disconnected = 0;
  connect<T>(n: T): T { this.connected++; return n; }
  disconnect() { this.disconnected++; }
}
const stats = { contexts: 0, oscillators: 0, gains: 0, buffers: 0 };
class FakeAudioContext {
  currentTime = 0; state: "running" | "suspended" = "running"; sampleRate = 8000; destination = new Node();
  constructor() { stats.contexts++; }
  resume() { this.state = "running"; return Promise.resolve(); }
  createGain() { stats.gains++; const n = new Node() as Node & { gain: Param }; n.gain = new Param(); return n; }
  createOscillator() {
    stats.oscillators++;
    const n = new Node() as Node & { type: string; frequency: Param; detune: Param; start: (t: number) => void; stop: (t: number) => void; onended: null | (() => void) };
    n.frequency = new Param(); n.detune = new Param(); n.type = "sine"; n.onended = null;
    n.start = () => {}; n.stop = () => {};
    return n;
  }
  createBiquadFilter() { const n = new Node() as Node & { type: string; frequency: Param; Q: Param }; n.frequency = new Param(); n.Q = new Param(); n.type = "lowpass"; return n; }
  createBuffer(_c: number, len: number) { stats.buffers++; return { getChannelData: () => new Float32Array(Math.max(1, Math.floor(len))) }; }
  createBufferSource() { const n = new Node() as Node & { buffer: unknown; start: () => void }; n.buffer = null; n.start = () => {}; return n; }
}
const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.window = g;
g.AudioContext = FakeAudioContext;
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };

type Sound = typeof import("@/lib/sound");
type Engine = typeof import("./musicEngine");
let sound: Sound;
let engine: Engine;
before(async () => {
  sound = await import("@/lib/sound");
  engine = await import("./musicEngine");
});
const ac = () => sound.runningAudioContext() as unknown as FakeAudioContext;

/* ───────────── escenario (orden importa: el motor es un singleton, como en la app) ───────────── */

test("MOTOR 01 · antes del gesto: sin contexto de audio, sin capas y un hover no crea contexto", () => {
  engine.setMusicRoute("LOBBY");
  sound.playSound("ui.hover");
  assert.equal(stats.contexts, 0);
  assert.equal(sound.runningAudioContext(), null);
  assert.deepEqual(engine.musicDebug().layers, []);
});

test("MOTOR 02 · el primer gesto crea UN contexto y arranca el tema de la sala con fundido de entrada", async () => {
  engine.unlockMusic();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(stats.contexts, 1);
  const d = engine.musicDebug();
  assert.equal(d.plan.context, "LOBBY");
  assert.deepEqual(d.layers, [{ context: "LOBBY", stopping: false }]);
  assert.ok(d.plan.gain > 0);
});

test("MOTOR 03 · el planificador programa compases por adelantado (osciladores) sin ráfagas", () => {
  const before = stats.oscillators;
  engine.musicTick();
  const scheduled = stats.oscillators - before;
  assert.ok(scheduled > 0 && scheduled <= 4 * 2 * 20, String(scheduled));
  const again = stats.oscillators;
  engine.musicTick(); // mismo instante: ya está programado
  assert.equal(stats.oscillators, again);
});

test("MOTOR 04 · cambiar de sala funde: la saliente se marca y convive con la entrante (2 capas máx.)", () => {
  engine.setMusicRoute("COLLECTION");
  const d = engine.musicDebug();
  assert.deepEqual(d.layers, [{ context: "LOBBY", stopping: true }, { context: "COLLECTION", stopping: false }]);
});

test("MOTOR 05 · saltar de sala muy deprisa nunca deja más de 2 capas vivas", () => {
  for (const c of ["PACKS", "DECKS", "RANKED", "DRAFT", "CAMPAIGN", "LOBBY"] as const) {
    engine.setMusicRoute(c);
    assert.ok(engine.musicDebug().layers.length <= engine.MAX_LAYERS);
  }
  assert.equal(engine.musicDebug().layers.filter((l) => !l.stopping).length, 1, "un solo tema activo");
});

test("MOTOR 06 · pasado el fundido, las capas salientes se retiran", () => {
  ac().currentTime += 3;
  engine.musicTick();
  assert.deepEqual(engine.musicDebug().layers, [{ context: "LOBBY", stopping: false }]);
});

test("MOTOR 07 · pestaña oculta: ganancia 0 y no se programa nada; al volver retoma desde ahora", () => {
  engine.setMusicHidden(true);
  assert.equal(engine.musicDebug().plan.gain, 0);
  const before = stats.oscillators;
  ac().currentTime += 30;
  engine.musicTick();
  assert.equal(stats.oscillators, before, "oculta: nada");
  engine.setMusicHidden(false);
  engine.musicTick();
  const burst = stats.oscillators - before;
  assert.ok(burst > 0 && burst <= 4 * 2 * 20, `sin ráfaga de 30 s atrasados (${burst})`);
});

test("MOTOR 08 · duck del sobre: baja al 25 % y vuelve; liberar dos veces no descuenta dos", () => {
  const full = engine.musicDebug().plan.gain;
  const release = engine.duckMusic();
  assert.ok(Math.abs(engine.musicDebug().plan.gain - Math.round(full * 0.25 * 1000) / 1000) < 1e-9);
  release(); release();
  assert.equal(engine.musicDebug().plan.gain, full);
  assert.equal(engine.musicDebug().state.ducks, 0);
});

test("MOTOR 09 · resultado: el override impone RESULT y al desmontar vuelve la sala", () => {
  engine.setMusicRoute("MATCH");
  const release = engine.pushMusicOverride("RESULT");
  assert.equal(engine.musicDebug().plan.context, "RESULT");
  release(); release();
  assert.equal(engine.musicDebug().plan.context, "MATCH");
});

test("MOTOR 10 · silenciar la música desde ajustes para el tema (sin tocar los efectos)", () => {
  sound.setAudioSettings({ musicMuted: true });
  assert.equal(engine.musicDebug().plan.context, null);
  assert.equal(sound.effectiveGain() > 0, true);
  sound.setAudioSettings({ musicMuted: false });
  assert.equal(engine.musicDebug().plan.context, "MATCH");
});

test("MOTOR 11 · los ajustes se guardan en este dispositivo y se releen igual", () => {
  sound.setAudioSettings({ music: 0.35, sfx: 0.6 });
  const saved = JSON.parse(store.get(sound.AUDIO_STORAGE_KEY)!);
  assert.equal(saved.music, 0.35); assert.equal(saved.sfx, 0.6);
  assert.deepEqual(sound.parseAudioSettings(store.get(sound.AUDIO_STORAGE_KEY)!), sound.getAudioSettings());
});

test("MOTOR 12 · el volumen de música del motor sigue a general × música", () => {
  sound.setAudioSettings({ master: 0.5, music: 0.4 });
  assert.equal(engine.musicDebug().state.volume, 0.2);
});

/* ───────────── efectos ───────────── */

const ALL = () => Object.keys(sound.SOUND_EVENTS) as (keyof Sound["SOUND_EVENTS"])[];

test("SFX 01 · con el contexto activo, cada efecto del catálogo sintetiza algo y no lanza", async () => {
  sound.setAudioSettings({ muted: false, sfxMuted: false, sfx: 0.8, master: 0.8 });
  for (const k of ALL()) {
    const before = stats.oscillators + stats.buffers;
    // Los dos hovers comparten puerta (uno cada 90 ms de reloj real): se deja pasar el tiempo.
    if (sound.SOUND_EVENTS[k].hover) await new Promise((r) => setTimeout(r, 110));
    assert.doesNotThrow(() => sound.playSound(k), k);
    assert.ok(stats.oscillators + stats.buffers > before, `${k} suena`);
  }
});

test("SFX 02 · efectos silenciados: ningún efecto crea nodos (la música no cuenta)", () => {
  sound.setAudioSettings({ sfxMuted: true });
  for (const k of ALL()) { const b = stats.oscillators + stats.buffers; sound.playSound(k); assert.equal(stats.oscillators + stats.buffers, b, k); }
  sound.setAudioSettings({ sfxMuted: false });
});

test("SFX 03 · silencio general: ni efectos ni música", () => {
  sound.setAudioSettings({ muted: true });
  for (const k of ALL()) { const b = stats.oscillators + stats.buffers; sound.playSound(k); assert.equal(stats.oscillators + stats.buffers, b, k); }
  assert.equal(engine.musicDebug().plan.context, null);
  sound.setAudioSettings({ muted: false });
});

test("SFX 04 · volumen de efectos 0: nada", () => {
  sound.setAudioSettings({ sfx: 0 });
  const b = stats.oscillators + stats.buffers;
  sound.playSound("pack.open"); sound.playSound("card.legendary");
  assert.equal(stats.oscillators + stats.buffers, b);
  sound.setAudioSettings({ sfx: 0.8 });
});

test("SFX 05 · hover barrido 50 veces seguidas en el mismo instante → suena una vez", async () => {
  await new Promise((r) => setTimeout(r, 120));
  const b = stats.oscillators;
  for (let i = 0; i < 50; i++) sound.playSound("ui.hover");
  assert.equal(stats.oscillators - b, 1);
});

test("SFX 06 · los cues de partida (victoria/derrota) siguen sonando por la vía de Fase 44", () => {
  const b = stats.oscillators;
  sound.playCue("victory"); sound.playCue("defeat");
  assert.ok(stats.oscillators > b);
});

test("SFX 07 · un único AudioContext en toda la sesión (efectos y música comparten)", () => {
  assert.equal(stats.contexts, 1);
});
