/**
 * FASE 44.1 · MÚSICA — modelo PURO (sin Web Audio) del sistema de música del juego.
 *
 * Toda la música es ORIGINAL y PROCEDURAL: temas descritos como tempo, tónica, modo, progresión y patrones, que el
 * motor (`musicEngine.ts`) sintetiza en el navegador con osciladores. No hay ficheros de audio, descargas ni pistas de
 * terceros (nada de Riot/VALORANT/otros juegos). Es una banda sonora ambiental mínima; componer música «de estudio» es
 * una deuda P2 documentada, y esta arquitectura la acepta sin cambios (un tema = una entrada de `MUSIC_THEMES`).
 *
 * Reglas que este modelo garantiza (y las pruebas y el fuzzer comprueban):
 *   · nada suena antes de un gesto del jugador (`unlocked`), silenciado o con volumen 0;
 *   · UN solo tema activo a la vez (el motor funde el saliente y lo retira: como mucho 2 capas vivas);
 *   · fundidos de 500 a 1500 ms; pestaña oculta → ganancia 0 (y vuelta al volver); apertura de sobre → duck.
 */
import { environmentForPath, type EnvironmentVariant } from "@/design/environment";

export type MusicContext = "LOBBY" | "COLLECTION" | "PACKS" | "DECKS" | "CAMPAIGN" | "DRAFT" | "RANKED" | "MATCH" | "RESULT";
export const MUSIC_CONTEXTS: readonly MusicContext[] = ["LOBBY", "COLLECTION", "PACKS", "DECKS", "CAMPAIGN", "DRAFT", "RANKED", "MATCH", "RESULT"];

export interface MusicTheme {
  context: MusicContext;
  /** Carácter del tema (documentación y arnés; nunca se enseña como «canción»). */
  mood: string;
  bpm: number;
  /** Tónica en MIDI. */
  root: number;
  /** Modo: semitonos de la escala (7 notas). */
  mode: readonly number[];
  /** Grado de la escala (0-based) de cada compás; se repite. */
  progression: readonly number[];
  pad: "sine" | "triangle" | "sawtooth";
  /** Corte del filtro paso bajo del pad (Hz). */
  cutoff: number;
  pulse: "none" | "soft" | "drive";
  /** Arpegio en corcheas: índices de escala desde el acorde (−1 = silencio). `null` = sin arpegio. */
  arp: readonly number[] | null;
  /** Nivel relativo del tema (0..1) antes del volumen de música. */
  level: number;
}

const MINOR = [0, 2, 3, 5, 7, 8, 10] as const;
const DORIAN = [0, 2, 3, 5, 7, 9, 10] as const;
const LYDIAN = [0, 2, 4, 6, 7, 9, 11] as const;
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10] as const;
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10] as const;
const HARMONIC = [0, 2, 3, 5, 7, 8, 11] as const;
const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;

export const MUSIC_THEMES: Record<MusicContext, MusicTheme> = {
  LOBBY: { context: "LOBBY", mood: "Arena de acceso: pulso tranquilo y expectante", bpm: 96, root: 50, mode: DORIAN, progression: [0, 5, 3, 4], pad: "sawtooth", cutoff: 900, pulse: "soft", arp: [0, 2, 4, -1, 4, 2, 0, -1], level: 0.5 },
  COLLECTION: { context: "COLLECTION", mood: "Bóveda: luminoso, lento, sin prisa", bpm: 72, root: 53, mode: LYDIAN, progression: [0, 1, 0, 4], pad: "triangle", cutoff: 1400, pulse: "none", arp: [0, -1, 4, -1, 6, -1, 4, -1], level: 0.45 },
  PACKS: { context: "PACKS", mood: "Cámara de sobres: tensión contenida", bpm: 84, root: 45, mode: PHRYGIAN, progression: [0, 0, 1, 0], pad: "sawtooth", cutoff: 620, pulse: "soft", arp: null, level: 0.45 },
  DECKS: { context: "DECKS", mood: "Sala táctica: concentración", bpm: 88, root: 48, mode: MINOR, progression: [0, 3, 5, 4], pad: "triangle", cutoff: 1000, pulse: "soft", arp: [0, -1, 2, -1, 4, -1, 2, -1], level: 0.45 },
  CAMPAIGN: { context: "CAMPAIGN", mood: "Mapa del circuito: viaje", bpm: 80, root: 43, mode: MIXOLYDIAN, progression: [0, 6, 3, 0], pad: "sawtooth", cutoff: 1100, pulse: "soft", arp: [0, 2, 4, 7, 4, 2, -1, -1], level: 0.48 },
  DRAFT: { context: "DRAFT", mood: "Cámara de draft: decisión", bpm: 90, root: 46, mode: HARMONIC, progression: [0, 5, 4, 0], pad: "triangle", cutoff: 900, pulse: "soft", arp: [0, 2, 4, 2, 0, 2, 4, 6], level: 0.45 },
  RANKED: { context: "RANKED", mood: "Escenario competitivo: presión", bpm: 110, root: 40, mode: MINOR, progression: [0, 5, 6, 4], pad: "sawtooth", cutoff: 760, pulse: "drive", arp: [0, -1, 0, 4, -1, 0, 5, -1], level: 0.5 },
  MATCH: { context: "MATCH", mood: "Arena de duelo: pulso de partido, bajo para no tapar los cues", bpm: 118, root: 41, mode: PHRYGIAN, progression: [0, 1, 0, 6], pad: "sawtooth", cutoff: 700, pulse: "drive", arp: [0, 0, 4, 0, 5, 0, 4, 2], level: 0.38 },
  RESULT: { context: "RESULT", mood: "Resultado: resolución", bpm: 70, root: 50, mode: MAJOR, progression: [0, 3, 4, 0], pad: "triangle", cutoff: 1600, pulse: "none", arp: null, level: 0.4 },
};

/* ───────────── notas y compases ───────────── */

export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Nota MIDI de un grado de la escala del tema (los grados fuera de 0..6 suben/bajan de octava). */
export function scaleMidi(theme: MusicTheme, degree: number, octave = 0): number {
  const n = theme.mode.length;
  const d = Math.trunc(degree);
  const idx = ((d % n) + n) % n;
  return theme.root + 12 * octave + 12 * Math.floor(d / n) + theme.mode[idx];
}

export const barSeconds = (theme: MusicTheme): number => (4 * 60) / theme.bpm;

export type MusicVoice = "pad" | "bass" | "pulse" | "arp";
export interface NoteEvent { voice: MusicVoice; at: number; dur: number; midi: number }

/** Tope de notas por compás (presupuesto de nodos del motor). */
export const MAX_EVENTS_PER_BAR = 20;

/**
 * Las notas de un compás: determinista (mismo tema y compás → mismas notas). Cada 4.º compás el arpegio respira
 * (solo la primera mitad) para que el bucle no sea una cinta repetida.
 */
export function barEvents(theme: MusicTheme, bar: number): NoteEvent[] {
  const b = Number.isFinite(bar) ? Math.max(0, Math.trunc(bar)) : 0;
  const len = barSeconds(theme);
  const beat = len / 4;
  const degree = theme.progression[b % theme.progression.length];
  const out: NoteEvent[] = [];
  for (const step of [0, 2, 4]) out.push({ voice: "pad", at: 0, dur: len, midi: scaleMidi(theme, degree + step) });
  out.push({ voice: "bass", at: 0, dur: len * 0.9, midi: scaleMidi(theme, degree, -1) });
  if (theme.pulse !== "none") {
    const beats = theme.pulse === "drive" ? [0, 1, 2, 3] : [0, 2];
    for (const k of beats) out.push({ voice: "pulse", at: k * beat, dur: 0.22, midi: scaleMidi(theme, 0, -2) });
  }
  if (theme.arp) {
    const eighth = beat / 2;
    const steps = b % 4 === 3 ? 4 : 8;
    for (let i = 0; i < steps; i++) {
      const s = theme.arp[i % theme.arp.length];
      if (s < 0) continue;
      out.push({ voice: "arp", at: i * eighth, dur: eighth * 0.9, midi: scaleMidi(theme, degree + s, 1) });
    }
  }
  return out.slice(0, MAX_EVENTS_PER_BAR);
}

/* ───────────── rutas y fundidos ───────────── */

const CONTEXT_OF_ENVIRONMENT: Record<EnvironmentVariant, MusicContext> = {
  lobby: "LOBBY", collection: "COLLECTION", packs: "PACKS", loadout: "DECKS", campaign: "CAMPAIGN", draft: "DRAFT",
  ranked: "RANKED", match: "MATCH", season: "LOBBY", events: "LOBBY", profile: "COLLECTION", world: "LOBBY",
};

/** Rutas sin música de juego: herramientas internas y el arnés de diseño. */
const SILENT_PREFIXES = ["/admin", "/design-system"];

export function musicContextForPath(pathname: string): MusicContext | null {
  if (SILENT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  return CONTEXT_OF_ENVIRONMENT[environmentForPath(pathname)];
}

export const CROSSFADE_MIN_MS = 500;
export const CROSSFADE_MAX_MS = 1500;

/** Duración del fundido entre dos contextos: rápido hacia la acción, lento entre salas. Siempre 500–1500 ms. */
export function crossfadeMs(from: MusicContext | null, to: MusicContext | null): number {
  let ms: number;
  if (from === to) ms = CROSSFADE_MIN_MS;
  else if (to === "MATCH" || to === "RESULT") ms = 600;
  else if (from === "MATCH" || from === "RESULT") ms = 1000;
  else if (from === null || to === null) ms = 900;
  else ms = 1400;
  return Math.max(CROSSFADE_MIN_MS, Math.min(CROSSFADE_MAX_MS, ms));
}

/* ───────────── estado ───────────── */

/** Ganancia relativa de la música durante un duck (apertura de sobre, stinger). */
export const DUCK_LEVEL = 0.25;

export interface MusicState {
  unlocked: boolean;
  /** Contexto de la ruta. */
  route: MusicContext | null;
  /** Contexto forzado por una pantalla (resultado). Gana a la ruta. */
  override: MusicContext | null;
  /** Fuentes de duck activas (contador: sobre + stinger pueden solaparse). */
  ducks: number;
  hidden: boolean;
  /** Volumen efectivo de música 0..1 (general × música, 0 si silenciada). */
  volume: number;
}

export const INITIAL_MUSIC: MusicState = { unlocked: false, route: null, override: null, ducks: 0, hidden: false, volume: 0 };

export type MusicEvent =
  | { type: "unlock" }
  | { type: "route"; context: MusicContext | null }
  | { type: "override"; context: MusicContext | null }
  | { type: "duck"; on: boolean }
  | { type: "visibility"; hidden: boolean }
  | { type: "volume"; value: number };

const vol = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

export function musicReducer(s: MusicState, e: MusicEvent): MusicState {
  switch (e.type) {
    case "unlock": return s.unlocked ? s : { ...s, unlocked: true };
    case "route": return { ...s, route: e.context };
    case "override": return { ...s, override: e.context };
    case "duck": return { ...s, ducks: Math.max(0, Math.min(8, s.ducks + (e.on ? 1 : -1))) };
    case "visibility": return { ...s, hidden: e.hidden };
    case "volume": return { ...s, volume: vol(e.value) };
    default: return s;
  }
}

export interface MusicPlan { context: MusicContext | null; gain: number }

/** Qué debe sonar y a qué ganancia del bus de música. */
export function musicPlan(s: MusicState): MusicPlan {
  const context = s.unlocked && s.volume > 0 ? (s.override ?? s.route) : null;
  const gain = context === null || s.hidden ? 0 : s.volume * (s.ducks > 0 ? DUCK_LEVEL : 1);
  return { context, gain: Math.round(gain * 1000) / 1000 };
}

/** La apertura de sobre agacha la música mientras salen las cartas. */
/** F81 · la música se aparta durante toda la cinemática (intro → tensión → hero → resto) y vuelve en el resumen. */
export const packMusicDuck = (phase: string): boolean => ["opening", "walkout", "buildup", "hero", "hero_hold", "rest"].includes(phase);

/* ───────────── efectos: ritmo de los sonidos de paso ───────────── */

/** Puerta de frecuencia: deja pasar un disparo cada `minMs` como mucho (sonidos de hover). */
export function createRateGate(minMs: number) {
  let last = -Infinity;
  return (now: number): boolean => {
    if (!Number.isFinite(now)) return false;
    if (now - last < minMs && now >= last) return false;
    last = now;
    return true;
  };
}

export const HOVER_SOUND_MIN_MS = 90;
