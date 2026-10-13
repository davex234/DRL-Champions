/**
 * REPRODUCCIÓN DE UNA JUGADA — dominio puro, sin React y sin relojes propios.
 *
 * ────────────────────────── QUÉ RESUELVE ──────────────────────────
 *
 * Una jugada tiene PASOS, y cada paso guarda dónde está cada jugador. «Reproducirla» es enseñar los
 * pasos en orden y, entre uno y el siguiente, mover las fichas de donde estaban a donde van.
 *
 * Lo delicado es que el movimiento es PRESENTACIÓN: interpolar dos posiciones para animarlas no
 * puede tocar los datos. Por eso esto devuelve una FOTO calculada y nunca muta el plan.
 *
 * ────────────────────────── EL EMPAREJAMIENTO ──────────────────────────
 *
 * Para mover una ficha del paso 2 al 3 hay que saber que «es la misma ficha». Se empareja por `id`,
 * no por posición en la lista: si el entrenador borra un jugador en medio, emparejar por índice
 * haría que el resto se teletransportase. Una ficha que no existe en el paso anterior no se
 * interpola: aparece donde le toca, que es lo correcto —no venía de ningún sitio—.
 */
import type { Strat, StratStep, PlayerToken } from "@/domain/tactics/strat";

/** Cuánto dura la transición entre pasos. Dentro del margen del encargo (300–700 ms). */
export const STEP_TRANSITION_MS = 520;
/** Cadencia del avance automático. */
export const AUTOPLAY_MS = 3000;
export const AUTOPLAY_MIN_MS = 1500;
export const AUTOPLAY_MAX_MS = 8000;

export interface PlaybackState {
  /** Índice del paso que se está enseñando. Siempre dentro del rango. */
  index: number;
  playing: boolean;
  /** 0..1 dentro de la transición hacia `index`. 1 = ya asentado. */
  progress: number;
}

export const INITIAL_PLAYBACK: PlaybackState = { index: 0, playing: false, progress: 1 };

const clampIndex = (i: number, total: number) => Math.max(0, Math.min(total - 1, i));

export type PlaybackEvent =
  | { type: "goto"; index: number }
  | { type: "next" }
  | { type: "prev" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "toggle" }
  | { type: "progress"; value: number }
  | { type: "reset" };

/**
 * El reductor. `total` es cuántos pasos tiene la jugada; nunca se sale del rango y nunca se queda
 * reproduciendo en el último paso (llegar al final PARA, no vuelve al principio: un bucle sorprende
 * a quien está explicando).
 */
export function playbackReducer(s: PlaybackState, e: PlaybackEvent, total: number): PlaybackState {
  const n = Math.max(1, total);
  switch (e.type) {
    case "goto":
      return { ...s, index: clampIndex(e.index, n), progress: 0 };
    case "next": {
      if (s.index >= n - 1) return { ...s, playing: false, progress: 1 };
      return { ...s, index: s.index + 1, progress: 0 };
    }
    case "prev":
      return { ...s, index: clampIndex(s.index - 1, n), progress: 0 };
    case "play":
      // Reproducir desde el final no tiene sentido: se vuelve al principio.
      return s.index >= n - 1 ? { index: 0, playing: true, progress: 0 } : { ...s, playing: true };
    case "pause":
      return { ...s, playing: false };
    case "toggle":
      return playbackReducer(s, { type: s.playing ? "pause" : "play" }, n);
    case "progress":
      return { ...s, progress: Math.max(0, Math.min(1, e.value)) };
    case "reset":
      return { ...INITIAL_PLAYBACK };
  }
}

/** Suavizado: arranca y frena. Sin esto el movimiento parece un salto mecánico. */
export const easeInOut = (t: number): number =>
  t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

/**
 * La FOTO que hay que pintar: el paso `index`, con las fichas interpoladas desde el paso anterior.
 * No muta nada; devuelve jugadores nuevos.
 */
export function playbackFrame(
  strat: Pick<Strat, "steps">, state: PlaybackState,
): { step: StratStep | null; players: PlayerToken[] } {
  const steps = strat.steps ?? [];
  if (steps.length === 0) return { step: null, players: [] };

  const i = clampIndex(state.index, steps.length);
  const step = steps[i];
  const players = step.state?.players ?? [];

  // Primer paso, o transición ya terminada: se pinta tal cual.
  if (i === 0 || state.progress >= 1) return { step, players };

  const previos = new Map((steps[i - 1].state?.players ?? []).map((p) => [p.id, p]));
  const t = easeInOut(state.progress);

  return {
    step,
    players: players.map((p) => {
      const antes = previos.get(p.id);
      // Ficha que no existía en el paso anterior: aparece en su sitio, no viaja desde la nada.
      if (!antes) return p;
      return { ...p, x: antes.x + (p.x - antes.x) * t, y: antes.y + (p.y - antes.y) * t };
    }),
  };
}
