/**
 * PACK WALKOUT 0.2 · EL PASEO DE LA PERSONA (puro, sin three ni reloj).
 *
 * La persona camina con un clip esquelético SIN desplazamiento (Universal Animation Library, `Walk_Loop`) y la escena la
 * desplaza por el túnel. Para que los pies no patinen, la FASE del clip sale de la DISTANCIA recorrida (no del reloj):
 * cada ciclo del clip avanza exactamente su zancada medida con la variante con root motion. Así, al frenar, la cadencia
 * baja con la velocidad y el pie de apoyo se queda clavado al suelo.
 *
 * Perfil: arranque (de parado a crucero) → crucero a velocidad constante → frenada lineal (la cadencia cae con la
 * velocidad) → quieto en su marca, con el clip de reposo (`IDLE_CLIP`) entrando a medida que la velocidad baja.
 * Mismo instante → misma pose.
 */
import { clamp01 } from "./timeline";

/** Medido del clip con root motion (UAL1_Standard_RM.glb · Walk_Loop): 1,30 m por ciclo de 1,333 s (0,975 m/s). */
export const WALK_CLIP = { name: "Walk_Loop", cycle: 4 / 3, stride: 1.3 } as const;
/** Reposo al llegar (0.3: neutro; los brazos cruzados son ya una CELEBRACIÓN, `celebration.ts`). */
export const IDLE_CLIP = { name: "Idle_Loop", cycle: 2.5 } as const;

export interface WalkPlan {
  /** Z de salida (fondo del túnel) y Z de la marca donde se detiene (la cámara mira hacia −Z). */
  startZ: number;
  markZ: number;
  /** Segundos de arranque (de 0 a la velocidad de crucero) y de frenada (de crucero a 0). */
  accel: number;
  decel: number;
  /** Segundos quieto en la marca antes de que termine el beat de la persona. */
  settle: number;
  /** Por debajo de esta fracción de la velocidad de crucero el reposo empieza a sustituir al paso. */
  blendBelow: number;
}

/**
 * Fase del ciclo (0..1) en la que conviene DETENERSE: medida en el clip (`_walkout-footslide.ts`), hacia 0,33–0,36 el pie
 * izquierdo apoya justo bajo la pelvis y el derecho pasa a su lado en el aire, así que el reposo (pies juntos) apenas
 * los mueve. El trayecto se elige para que el paseo termine en esa fase: 4 ciclos completos + STOP_PHASE.
 */
export const STOP_PHASE = 0.36;
export const WALK_CYCLES = 4;
const MARK_Z = 0.5;

export const WALK_PLAN: WalkPlan = { startZ: MARK_Z - WALK_CLIP.stride * (WALK_CYCLES + STOP_PHASE), markZ: MARK_Z, accel: 0.7, decel: 1.15, settle: 0.3, blendBelow: 0.42 };

export interface WalkState {
  /** Posición Z de la persona. */
  z: number;
  /** Metros recorridos desde la salida. */
  distance: number;
  /** Velocidad (m/s). */
  speed: number;
  /** Instante del clip de paso (s), atado a la distancia: fase = distancia / zancada. */
  walkTime: number;
  /** Peso del clip de paso (1 caminando · 0 quieto). */
  walkWeight: number;
  /** Instante del clip de reposo (s desde que empieza a entrar). */
  idleTime: number;
  stopped: boolean;
  /** Instante (s del beat) en que el reposo empieza a sustituir al paso: desde ahí se clava el pie de apoyo. */
  blendStart: number;
}

/** Segundos a velocidad constante (lo que queda del beat tras arrancar, frenar y quedarse quieto). */
const cruiseTime = (dur: number, plan: WalkPlan) => Math.max(0.1, dur - plan.accel - plan.decel - plan.settle);

/** Velocidad de crucero para recorrer el trayecto en `dur` segundos con el arranque, la frenada y el reposo del plan. */
export function cruiseSpeed(dur: number, plan: WalkPlan = WALK_PLAN): number {
  return (plan.markZ - plan.startZ) / (plan.accel / 2 + cruiseTime(dur, plan) + plan.decel / 2);
}

/** Estado del paseo a `t` segundos del inicio del beat de la persona (que dura `dur`). */
export function walkAt(t: number, dur: number, plan: WalkPlan = WALK_PLAN): WalkState {
  const total = plan.markZ - plan.startZ;
  const v = cruiseSpeed(dur, plan);
  const ta = plan.accel, tc = ta + cruiseTime(dur, plan);           // fin del arranque · fin del crucero
  const k = Math.max(0, t);
  let distance: number, speed: number;
  if (k < ta) { distance = (v * k * k) / (2 * ta); speed = (v * k) / ta; }
  else if (k <= tc) { distance = (v * ta) / 2 + v * (k - ta); speed = v; }
  else if (k < tc + plan.decel) { const u = k - tc; distance = (v * ta) / 2 + v * (tc - ta) + v * u - (v * u * u) / (2 * plan.decel); speed = v * (1 - u / plan.decel); }
  else { distance = total; speed = 0; }
  distance = Math.min(total, distance);
  // el reposo solo sustituye al paso en la FRENADA (en el arranque ya camina: sale de un paso)
  const frac = k < tc ? 1 : v > 0 ? speed / v : 0;
  const s = clamp01(frac / plan.blendBelow);
  const walkWeight = s * s * (3 - 2 * s);
  // El reposo arranca cuando empieza a sustituir al paso (no antes: su respiración nace en la frenada).
  const blendStart = tc + plan.decel * (1 - plan.blendBelow);
  return {
    z: plan.startZ + distance,
    distance,
    speed,
    walkTime: (distance / WALK_CLIP.stride) * WALK_CLIP.cycle,
    walkWeight,
    idleTime: Math.max(0, k - blendStart),
    stopped: k >= tc + plan.decel,
    blendStart,
  };
}

/** Cadencia relativa al clip (1 = la del clip; >1 = pasos más rápidos). Sirve para comprobar que el paso es creíble. */
export const cadenceScale = (speed: number) => speed / (WALK_CLIP.stride / WALK_CLIP.cycle);

/**
 * Instantes (s desde el inicio del beat) en que un pie toca el suelo: cada media zancada recorrida (el clip apoya en
 * su instante 0 y a mitad de ciclo). El audio de pasos se cuadra con ellos, no con un metrónomo.
 */
export function footfalls(dur: number, plan: WalkPlan = WALK_PLAN, step = 1 / 60): number[] {
  const out: number[] = [];
  const half = WALK_CLIP.stride / 2;
  let next = half;
  for (let t = 0; t <= dur; t += step) {
    const d = walkAt(t, dur, plan).distance;
    while (d >= next - 1e-9) { out.push(+t.toFixed(3)); next += half; }
    if (walkAt(t, dur, plan).stopped) break;
  }
  return out;
}

/* ───────── 0.4 · paso con FRENADA CAPTURADA (Rocketbox `m_walk_stop`) ───────── */

/** Frenada de captura: su duración, su avance real a 30 Hz (`curve`, m desde el inicio) y la distancia total. */
export interface StopSpec { duration: number; curve: readonly number[]; distance: number }
/** El paso de un asset: zancada por ciclo del clip y, si la trae, su frenada. */
export interface WalkSpec { stride: number; cycle: number; stop: StopSpec | null }

/** Lee el paso del asset (extras que deja `_walkout-rocketbox-build.mjs`); null si el asset no lo declara. */
export function walkSpecFromExtras(extras: unknown): WalkSpec | null {
  const c = (extras as { walkout?: { clips?: Record<string, { duration: number; rootDelta: number[]; curve?: number[] }> } } | undefined)?.walkout?.clips;
  const w = c?.Walk_Loop, s = c?.Walk_Stop;
  if (!w || !(w.rootDelta?.[2] > 0) || !(w.duration > 0)) return null;
  const stop = s && Array.isArray(s.curve) && s.curve.length > 2 ? { duration: s.duration, curve: s.curve, distance: s.curve[s.curve.length - 1] } : null;
  return { stride: w.rootDelta[2], cycle: w.duration, stop };
}

export interface StopWalkState extends WalkState {
  /** Instante de la frenada capturada (s) o null si aún camina. */
  stopTime: number | null;
  /** Peso de la frenada (entra en 0,25 s) y del reposo (en los últimos 0,35 s de la frenada). */
  stopWeight: number;
  idleWeight: number;
}

const STOP_IN = 0.25, IDLE_IN = 0.35;

/** Plan del paseo con frenada: ciclos ENTEROS de crucero (la frenada entra en la misma fase en que se capturó). */
export function stopPlan(dur: number, spec: WalkSpec, markZ = WALK_PLAN.markZ, accel = WALK_PLAN.accel, settle = WALK_PLAN.settle) {
  const stop = spec.stop!;
  const tStop = Math.max(accel + 0.5, dur - settle - stop.duration);
  const natural = spec.stride / spec.cycle;
  const cycles = Math.max(1, Math.round((natural * (tStop - accel / 2)) / spec.stride));
  const cruiseDist = cycles * spec.stride;
  const v = cruiseDist / (tStop - accel / 2);
  return { tStop, cycles, cruiseDist, v, startZ: markZ - cruiseDist - stop.distance, markZ };
}

/**
 * Paseo con frenada capturada: arranque y crucero atados a la distancia (sin patinar), después la frenada del clip con
 * su propio avance (los pies apoyan como en la captura) y, al acabar, el reposo. Puro: mismo instante → mismo estado.
 */
export function walkAtWithStop(t: number, dur: number, spec: WalkSpec): StopWalkState {
  const P = stopPlan(dur, spec);
  const stop = spec.stop!;
  const k = Math.max(0, t), ta = WALK_PLAN.accel;
  let distance: number, speed: number, stopTime: number | null = null;
  if (k < ta) { distance = (P.v * k * k) / (2 * ta); speed = (P.v * k) / ta; }
  else if (k < P.tStop) { distance = (P.v * ta) / 2 + P.v * (k - ta); speed = P.v; }
  else {
    stopTime = Math.min(stop.duration, k - P.tStop);
    const f = stopTime * 30, i = Math.min(stop.curve.length - 2, Math.floor(f)), u = Math.min(1, f - i);
    distance = P.cruiseDist + stop.curve[i] + (stop.curve[i + 1] - stop.curve[i]) * u;
    speed = (stop.curve[Math.min(stop.curve.length - 1, i + 1)] - stop.curve[i]) * 30;
  }
  const ss = (x: number) => { const q = clamp01(x); return q * q * (3 - 2 * q); };
  const stopWeight = stopTime === null ? 0 : ss(stopTime / STOP_IN) * (1 - ss((stopTime - (stop.duration - IDLE_IN)) / IDLE_IN));
  const idleWeight = stopTime === null ? 0 : ss((stopTime - (stop.duration - IDLE_IN)) / IDLE_IN);
  const walkTime = (Math.min(distance, P.cruiseDist) / spec.stride) * spec.cycle;
  const blendStart = P.tStop + stop.duration - IDLE_IN;
  return {
    z: P.startZ + distance, distance, speed, walkTime,
    walkWeight: 1 - stopWeight - idleWeight, idleTime: Math.max(0, k - blendStart),
    stopped: stopTime !== null && stopTime >= stop.duration, blendStart, stopTime, stopWeight, idleWeight,
  };
}

/**
 * Apoyos MEDIDOS de la persona Rocketbox (scripts/_walkout-contacts.ts: el talón baja del 15 % de la altura de paso y se
 * queda ≥ 0,1 s): instantes dentro del ciclo de `Walk_Loop` y desde el inicio de `Walk_Stop`. Con la zancada y el ciclo
 * del asset (un test los compara con sus extras) dan los pasos que SE OYEN donde se ven, sin cargar el glTF.
 */
export const ROCKETBOX_STEPS = { stride: 1.5054, cycle: 1.125, stopDuration: 2, walk: [0.375, 0.917], stop: [0.367, 0.792, 1.017] } as const;

/** Pasos (s desde el inicio del paseo) del paseo con frenada capturada: los del crucero según la fase del clip y los de la frenada. */
export function footfallsWithStop(dur: number, s: { stride: number; cycle: number; stopDuration: number; walk: readonly number[]; stop: readonly number[] } = ROCKETBOX_STEPS, step = 1 / 120): number[] {
  const spec: WalkSpec = { stride: s.stride, cycle: s.cycle, stop: { duration: s.stopDuration, curve: [0, 0, 0], distance: 0 } };
  const P = stopPlan(dur, spec);
  const out: number[] = [];
  let prev = 0;
  for (let t = step; t < P.tStop; t += step) {
    const w = walkAtWithStop(t, dur, spec).walkTime;
    for (const c of s.walk) {
      // cruza la fase de un apoyo en algún ciclo entre el fotograma anterior y este
      const k0 = Math.floor((prev - c) / s.cycle), k1 = Math.floor((w - c) / s.cycle);
      if (k1 > k0 && w > 0.05) out.push(+t.toFixed(3));
    }
    prev = w;
  }
  for (const c of s.stop) if (P.tStop + c <= dur) out.push(+(P.tStop + c).toFixed(3));
  return out.sort((a, b) => a - b);
}
