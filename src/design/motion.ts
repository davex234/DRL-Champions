/**
 * SISTEMA DE MOVIMIENTO NEXUS (Fase 9.6).
 *
 * La Fase 9.5 dejó el vocabulario de SUPERFICIES resuelto (escenario / objeto / panel /
 * dato) pero el movimiento seguía improvisándose: cada pantalla escribía su propio
 * `initial/animate/transition` con duraciones distintas para el mismo gesto. Dos rejillas
 * que entran a velocidades diferentes se leen como dos productos.
 *
 * Aquí viven los SEIS momentos del producto, y solo seis. Si un movimiento nuevo no cabe
 * en uno de ellos, probablemente no debería existir.
 *
 *   1. ENTRADA     — una pantalla o una sección aparece.
 *   2. ELECCIÓN    — algo responde al puntero o se selecciona.
 *   3. REVELACIÓN  — una carta se descubre, un turno se resuelve.
 *   4. RECOMPENSA  — un nivel sube, un premio se reclama.
 *   5. IMPACTO     — un choque: victoria, derrota, ascenso de rango.
 *   6. AMBIENTE    — respiración lenta de un objeto en reposo (vitrina, sobre sellado).
 *
 * REGLAS QUE NO SE NEGOCIAN
 *
 *   · Nada por encima de 350 ms en interfaz. Las revelaciones son la excepción y tienen
 *     su propia escala (`DURATION.reveal`).
 *   · Solo se anima `transform` y `opacity`. Animar `width`, `top` o `filter` provoca
 *     layout/paint por fotograma y es exactamente la regresión que la Fase 9.5 cazó en
 *     la colección. Las barras de progreso son la única excepción tolerada, porque su
 *     transición ocurre UNA vez y no en bucle.
 *   · `prefers-reduced-motion` no recibe una versión lenta: recibe una ESTÁTICA. Todo lo
 *     que se exporta aquí tiene su equivalente quieto vía `still()`.
 *   · Los bucles infinitos se cuentan con los dedos de una mano por pantalla. Un `repeat:
 *     Infinity` es una promesa de gasto de CPU mientras la pestaña esté abierta.
 */
import type { Transition, Variants } from "framer-motion";
import { DURATION, EASING } from "./tokens";

/** Curvas en el formato de framer-motion (bezier como tupla). */
export const EASE = {
  /** Lo que entra: rápido al principio, se asienta. */
  out: [0.16, 1, 0.3, 1] as const,
  /** Lo que se mueve de un sitio a otro. */
  inOut: [0.65, 0, 0.35, 1] as const,
  /** Lo físico: sobrepasa y vuelve. Para objetos, no para paneles. */
  spring: [0.34, 1.56, 0.64, 1] as const,
};

const s = (ms: number) => ms / 1000;

// ───────────────────────────── 1 · ENTRADA ─────────────────────────────

/**
 * Entrada de una sección. Sube 12 px y aparece. No más: una pantalla cuyos bloques
 * recorren 40 px se percibe lenta aunque dure lo mismo.
 */
export const enter: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: s(DURATION.normal), ease: EASE.out } },
};

/**
 * Contenedor que escalona a sus hijos. El escalón se ACOTA en el componente: con 60
 * cartas, 35 ms por hijo dejaría la última entrando dos segundos tarde.
 */
export const stagger = (step = 0.04, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: step, delayChildren: delay } },
});

/** Retardo escalonado acotado, para rejillas largas que no usan variants. */
export function staggerDelay(index: number, step = 0.035, max = 0.45): number {
  return Math.min(index * step, max);
}

// ───────────────────────────── 2 · ELECCIÓN ─────────────────────────────

/** Un objeto pulsable responde: se eleva un pelo. Nunca escala más de un 4 %. */
export const pick = {
  rest: { scale: 1, y: 0 },
  hover: { scale: 1.03, y: -4, transition: { duration: s(DURATION.instant), ease: EASE.out } },
  tap: { scale: 0.985, transition: { duration: 0.08 } },
};

// ───────────────────────────── 3 · REVELACIÓN ─────────────────────────────

/** Algo que se descubre: irrumpe, sobrepasa y asienta. */
export const revealPop: Transition = {
  duration: s(DURATION.reveal * 0.75),
  ease: EASE.out,
};

// ───────────────────────────── 4 · RECOMPENSA ─────────────────────────────

/**
 * Un premio reclamado. Es el único gesto del producto que puede permitirse rebotar:
 * la recompensa es justo el momento en el que la interfaz debe sentirse física.
 */
export const reward: Variants = {
  hidden: { opacity: 0, scale: 0.7 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: s(DURATION.slow), ease: EASE.spring },
  },
};

// ───────────────────────────── 5 · IMPACTO ─────────────────────────────

/** Choque: entra grande y se cierra sobre sí mismo. Victoria, derrota, ascenso. */
export const impact: Variants = {
  hidden: { opacity: 0, scale: 1.35 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: s(DURATION.slow), ease: EASE.out },
  },
};

// ───────────────────────────── 6 · AMBIENTE ─────────────────────────────

/**
 * Respiración de un objeto en reposo. Ciclo LARGO a propósito: por debajo de ~4 s deja de
 * leerse como «flota» y pasa a leerse como «vibra».
 */
export const idleFloat = (amplitude = 8, seconds = 5.5) => ({
  y: [0, -amplitude, 0],
  transition: { duration: seconds, repeat: Infinity, ease: "easeInOut" as const },
});

// ───────────────────────────── Reducción de movimiento ─────────────────────────────

/**
 * Devuelve la variante quieta equivalente. Se usa con `useReducedMotion()`:
 *
 *   const reduced = useReducedMotion();
 *   <motion.div variants={still(enter, reduced)} …/>
 *
 * No degrada a «lento»: apaga el desplazamiento y deja solo el fundido, que es lo que
 * pide la preferencia —no ver movimiento, no ver una versión perezosa del movimiento.
 */
export function still(variants: Variants, reduced: boolean | null): Variants {
  if (!reduced) return variants;
  return {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { duration: s(DURATION.fast) } },
  };
}

/** Transición neutra para lo que solo debe aparecer. */
export const fade: Transition = { duration: s(DURATION.fast), ease: EASE.out };

/** Curva CSS lista para `style`, cuando el movimiento no pasa por framer-motion. */
export const CSS_EASE = EASING.out;

// ═════════════════════════════ FASE 44 · GAME EXPERIENCE 4.0 ═════════════════════════════
//
// Los seis momentos siguen siendo el vocabulario. Lo que faltaba era una ESCALA de impacto que
// diga cuánto movimiento merece cada cosa, para que «todo se mueve» no pueda pasar por descuido:
//
//   LEVEL 0 · estático          — texto, cifras en reposo, listas.
//   LEVEL 1 · microinteracción  — hover, foco, pulsación (80–180 ms).
//   LEVEL 2 · transición        — cambio de pantalla, panel, hoja, revelado común (150–350 ms).
//   LEVEL 3 · momento           — victoria, derrota, subida de nivel, objetivo, plantilla lista, rara/épica.
//   LEVEL 4 · excepcional       — legendaria, serial #1. Nunca más de uno a la vez.
//
// Regla de uso: un componente declara su nivel (`data-motion-level`) y toma de aquí la duración.
// Con `prefers-reduced-motion` TODOS los niveles se aplastan a un fundido corto (`reducedTransition`).

/** Duraciones de juego en ms. Nombres del encargo; los valores salen de `DURATION`. */
export const MOTION = {
  /** Microinteracción: hover, foco, pulsación. */
  fast: DURATION.instant,
  /** Panel, hoja, pestaña, cambio de pantalla. */
  normal: 220,
  /** Entrada de escena de juego (pre-partida, selector de modos, ceremonia). */
  game: DURATION.normal,
  /** Momento importante (victoria, subida de nivel). */
  celebration: DURATION.slow,
  /** Momento excepcional (legendaria, serial #1). Tope duro: nada obligatorio pasa de aquí. */
  exceptional: DURATION.reveal,
} as const;

export type MotionLevel = 0 | 1 | 2 | 3 | 4;

/** Presupuesto por nivel: duración máxima de UNA animación y si puede tener partículas/luz de pantalla. */
export const MOTION_LEVELS: Record<MotionLevel, { name: string; maxMs: number; particles: boolean; screenLight: boolean; examples: string[] }> = {
  0: { name: "Estático", maxMs: 0, particles: false, screenLight: false, examples: ["texto", "listas", "cifras en reposo"] },
  1: { name: "Microinteracción", maxMs: 180, particles: false, screenLight: false, examples: ["hover de carta", "foco", "pulsar botón"] },
  2: { name: "Transición", maxMs: 350, particles: false, screenLight: false, examples: ["entrar en Jugar", "abrir hoja", "revelar común"] },
  3: { name: "Momento", maxMs: 900, particles: false, screenLight: true, examples: ["victoria", "subida de nivel", "objetivo completado", "plantilla lista", "rara/épica"] },
  4: { name: "Excepcional", maxMs: 1200, particles: true, screenLight: true, examples: ["legendaria", "serial #1"] },
};

/** Muelles de framer, con moderación: objetos físicos (cartas, botones, hojas), nunca paneles de texto. */
export const SPRING = {
  card: { type: "spring" as const, stiffness: 420, damping: 32, mass: 0.8 },
  button: { type: "spring" as const, stiffness: 700, damping: 38 },
  sheet: { type: "spring" as const, stiffness: 360, damping: 36 },
};

/** Transición que debe usar TODO lo animado cuando el jugador pide menos movimiento. */
export const reducedTransition: Transition = { duration: 0.12, ease: "linear" };

/** Duración efectiva (ms) de un nivel con o sin movimiento reducido. */
export function levelDuration(level: MotionLevel, reduced: boolean): number {
  if (level === 0) return 0;
  if (reduced) return 120;
  return MOTION_LEVELS[level].maxMs;
}

/**
 * FAMILIAS DE TRANSICIÓN DE PANTALLA. No hay veinte: hay cuatro, y la familia sale de la ruta.
 *
 *   gameplay    — jugar, modos, duelos, campaña, draft: directa (sube y aparece, 180 ms).
 *   collection  — colección, sobres, equipos: profundidad (escala desde 0,985, 240 ms).
 *   season      — temporada, logros, progresión, perfil: luz (fundido con barrido, 300 ms).
 *   default     — el resto: fundido corto (200 ms).
 */
export type TransitionFamily = "gameplay" | "collection" | "season" | "default";

const FAMILY_PREFIXES: [TransitionFamily, string[]][] = [
  ["gameplay", ["/jugar", "/duelos", "/social", "/pickems", "/torneos"]],
  ["collection", ["/coleccion", "/colecciones", "/inventario", "/tienda", "/packs", "/equipo", "/eventos"]],
  ["season", ["/temporada", "/temporadas", "/logros", "/progresion", "/recompensas", "/jugador", "/ranking", "/cuenta"]],
];

export function transitionFamily(pathname: string): TransitionFamily {
  // Equipos vive bajo /duelos pero se prepara como la colección, no como una partida.
  if (pathname === "/duelos/mazos" || pathname.startsWith("/duelos/mazos/")) return "collection";
  for (const [family, prefixes] of FAMILY_PREFIXES) {
    if (prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return family;
  }
  return "default";
}

export interface PageMotion {
  initial: { opacity: number; y?: number; scale?: number };
  animate: { opacity: number; y?: number; scale?: number };
  transition: Transition;
  /** ms totales, para verificar el presupuesto (150–350 ms). */
  ms: number;
}

/** La entrada de pantalla de una familia. Solo `transform` y `opacity`; con movimiento reducido, fundido. */
export function pageMotion(family: TransitionFamily, reduced: boolean): PageMotion {
  if (reduced) return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: reducedTransition, ms: 120 };
  switch (family) {
    case "gameplay":
      return { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.18, ease: EASE.out }, ms: 180 };
    case "collection":
      return { initial: { opacity: 0, scale: 0.985 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.24, ease: EASE.out }, ms: 240 };
    case "season":
      return { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: EASE.out }, ms: 300 };
    default:
      return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2, ease: EASE.out }, ms: 200 };
  }
}

/** Escalonado acotado para rejillas (colección): como mucho `cap` elementos animan; el resto aparece sin retardo. */
export function boundedStagger(index: number, cap = 24, step = 0.025): number {
  return index < cap ? index * step : 0;
}
