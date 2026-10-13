/**
 * PACK WALKOUT · LA TIMELINE (puro, determinista, sin React ni reloj).
 *
 * Una escena = una lista de BEATS con su instante y su duración. La intensidad (STANDARD · RARE · WALKOUT · MEGA_WALKOUT)
 * y el movimiento reducido solo cambian ESTA configuración: el escenario y las piezas que la pintan son los mismos.
 * `frameAt(t)` dice, para cualquier instante, el progreso (0..1) de cada beat: el director lo lee en cada fotograma y
 * SALTAR es simplemente ir a `duration`. Mismo input → mismos beats (nada aleatorio aquí; la recompensa no vive aquí).
 *
 * Prototipo 0.1 (2026-10-07): la intensidad la elige quien llama. NO hay ninguna regla OVR/rareza → intensidad.
 */
export type WalkoutIntensity = "STANDARD" | "RARE" | "WALKOUT" | "MEGA_WALKOUT";
export const WALKOUT_INTENSITIES: readonly WalkoutIntensity[] = ["STANDARD", "RARE", "WALKOUT", "MEGA_WALKOUT"];

/** Momentos de la escena, en su orden narrativo. */
export type BeatId =
  | "pack" | "open" | "blackout" | "lights" | "human" | "flag" | "role" | "team" | "edition" | "celebrate"
  | "ovrFirst" | "ovrFull" | "flash" | "name" | "card" | "final";

export interface Beat {
  id: BeatId;
  /** Segundo en que empieza. */
  at: number;
  /** Cuánto dura su animación de entrada (después queda «encendido»). */
  dur: number;
}

export interface WalkoutTimeline {
  intensity: WalkoutIntensity;
  reduced: boolean;
  beats: Beat[];
  /** Instante del estado final (todo revelado). */
  duration: number;
  /** ¿Hay persona caminando y cámara que se acerca? (WALKOUT/MEGA; no con movimiento reducido). */
  walk: boolean;
  /** 0.3 · persona 3D: «walk» (entra caminando), «stand» (RARE: ya está en la plataforma, pose breve) o ninguna. */
  human: "walk" | "stand" | null;
}

type BeatTable = Partial<Record<BeatId, [at: number, dur: number]>>;

/**
 * La referencia del encargo para WALKOUT (0.1: final a los 10,5 s; 0.2: final a los 11,0 s), como CONFIGURACIÓN. Las demás
 * intensidades son la misma secuencia comprimida o estirada. Cambiar un tiempo = cambiar esta tabla.
 */
export const BEAT_TABLES: Readonly<Record<WalkoutIntensity, BeatTable>> = {
  STANDARD: {
    pack: [0, 0.3], open: [0.3, 0.3], blackout: [0.6, 0.15], lights: [0.7, 0.4],
    edition: [0.8, 0.3], ovrFirst: [0.9, 0.2], ovrFull: [1.1, 0.2], flash: [1.35, 0.25],
    name: [1.55, 0.3], card: [1.6, 0.5], final: [2.6, 0.01],
  },
  RARE: {
    pack: [0, 0.4], open: [0.5, 0.4], blackout: [0.9, 0.25], lights: [1.1, 0.6], human: [1.15, 3.35],
    flag: [1.5, 0.7], role: [2.3, 0.5], edition: [3.0, 0.4], celebrate: [3.1, 1.0], ovrFirst: [3.4, 0.3], ovrFull: [3.9, 0.3],
    flash: [4.5, 0.3], name: [4.7, 0.4], card: [4.8, 0.6], final: [5.8, 0.01],
  },
  // Walkout 0.3: 0–2 sobre y apagón · 2–3 la arena se enciende y la figura aparece al fondo · 3–7 paseo con bandera, rol y
  // escudo · 7–8,3 frena y se detiene en la plataforma · 8,3–10,6 CELEBRA (la media entra a su lado mientras tanto) ·
  // 10,8 flash · la persona se disuelve en luz y sale la carta.
  WALKOUT: {
    pack: [0.3, 0.5], open: [0.9, 0.45], blackout: [1.4, 0.4], lights: [2.0, 1.0], human: [2.5, 6.0],
    flag: [3.5, 0.8], role: [4.6, 0.6], team: [5.7, 0.6], edition: [7.6, 0.5], celebrate: [8.3, 2.6],
    ovrFirst: [9.7, 0.4], ovrFull: [10.2, 0.35], flash: [10.8, 0.4], name: [11.35, 0.45], card: [11.5, 0.85], final: [12.6, 0.01],
  },
  MEGA_WALKOUT: {
    pack: [0.4, 0.6], open: [1.1, 0.5], blackout: [1.6, 0.6], lights: [2.2, 1.2], human: [2.8, 6.8],
    flag: [4.0, 0.9], role: [5.2, 0.7], team: [6.5, 0.7], edition: [8.6, 0.6], celebrate: [9.7, 2.6],
    ovrFirst: [11.3, 0.5], ovrFull: [11.9, 0.45], flash: [12.6, 0.45], name: [13.2, 0.5], card: [13.4, 0.9], final: [14.6, 0.01],
  },
};

/** Movimiento reducido: ni paseo, ni cámara, ni grandes caídas — las pistas y la carta con transiciones mínimas. */
export const REDUCED_TABLE: BeatTable = {
  flag: [0.1, 0.25], role: [0.6, 0.25], team: [1.1, 0.25], edition: [1.6, 0.25],
  ovrFirst: [2.0, 0.2], ovrFull: [2.2, 0.2], name: [2.6, 0.25], card: [2.7, 0.3], final: [3.3, 0.01],
};

export function buildTimeline(intensity: WalkoutIntensity, opts: { reduced?: boolean } = {}): WalkoutTimeline {
  const reduced = !!opts.reduced;
  const table = reduced ? REDUCED_TABLE : BEAT_TABLES[intensity];
  const beats = (Object.entries(table) as [BeatId, [number, number]][])
    .map(([id, [at, dur]]) => ({ id, at, dur }))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const final = beats.find((b) => b.id === "final");
  const hasHuman = !reduced && beats.some((b) => b.id === "human");
  const human = !hasHuman ? null : intensity === "RARE" ? "stand" : "walk";
  return { intensity, reduced, beats, duration: final ? final.at : Math.max(...beats.map((b) => b.at + b.dur)), walk: human === "walk", human };
}

export interface WalkoutFrame {
  t: number;
  /** Progreso de entrada de cada beat de la timeline: 0 antes de empezar, 1 al terminar (y después). Ausente = no existe. */
  p: Partial<Record<BeatId, number>>;
  done: boolean;
}

/** El estado de la escena en el instante `t` (segundos). Puro: el mismo `t` da siempre el mismo fotograma. */
export function frameAt(tl: WalkoutTimeline, t: number): WalkoutFrame {
  const clamped = Math.max(0, Math.min(t, tl.duration));
  const p: WalkoutFrame["p"] = {};
  const done = clamped >= tl.duration;
  // En el estado final TODO está revelado (también el beat `final`, que empieza justo en `duration`).
  for (const b of tl.beats) p[b.id] = done ? 1 : b.dur <= 0 ? (clamped >= b.at ? 1 : 0) : Math.max(0, Math.min(1, (clamped - b.at) / b.dur));
  return { t: clamped, p, done };
}

/** Beats que han EMPEZADO entre `from` (excluido) y `to` (incluido): el director dispara su sonido una sola vez. */
export function beatsCrossed(tl: WalkoutTimeline, from: number, to: number): BeatId[] {
  return tl.beats.filter((b) => b.at > from && b.at <= to).map((b) => b.id);
}

/* ───────── curvas (puras) ───────── */

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const easeOutCubic = (x: number) => 1 - (1 - clamp01(x)) ** 3;
export const easeInOutCubic = (x: number) => { const k = clamp01(x); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };
/**
 * Caída con peso: baja acelerando, se pasa un poco y se asienta (oscilación amortiguada, sin rebote de juguete).
 * Devuelve el desplazamiento restante (1 = arriba del todo, 0 = en su sitio).
 */
export function heavyDrop(x: number, overshoot = 0.08): number {
  const k = clamp01(x);
  if (k < 0.55) return 1 - (k / 0.55) ** 2;           // cae acelerando
  const s = (k - 0.55) / 0.45;                         // asienta: un pequeño paso por debajo y vuelta
  return -overshoot * Math.sin(s * Math.PI) * (1 - s);
}
