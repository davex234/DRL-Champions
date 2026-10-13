/**
 * FASE 51 · HISTORIAL DE EDICIÓN DE LA PIZARRA (deshacer / rehacer). Puro, sin React.
 *
 * La pizarra editaba sin red: quitar la ficha equivocada o una flecha mal trazada obligaba a
 * rehacerla a mano. Esto guarda instantáneas del `Strat` completo y permite ir y volver.
 *
 * ────────────────────────── DECISIONES ──────────────────────────
 *
 * · INSTANTÁNEAS, no operaciones inversas. Las transformaciones del dominio (`updateStep`,
 *   `addUtility`, `moveObject`…) ya son inmutables y comparten los pasos que no tocan, así que
 *   una instantánea cuesta lo que cambió. Invertir cada operación a mano sería reescribir el
 *   dominio con otra forma de romperse.
 * · LÍMITE: `HISTORY_LIMIT` entradas hacia atrás. Una jugada pesa como mucho `MAX_PLAN_BYTES`
 *   (256 KB) y comparte estructura entre instantáneas: 80 entradas es holgado para una sesión de
 *   trabajo y acota la memoria aunque alguien edite durante horas.
 * · AGRUPACIÓN: arrastrar una ficha emite un movimiento por cada `pointermove`. Sin agrupar, deshacer
 *   un arrastre costaría cien pulsaciones. Las mutaciones con la MISMA `key` separadas por menos
 *   de `COALESCE_MS` se funden en una sola entrada (el arrastre entero, las teclas de flecha
 *   seguidas, lo que se escribe en el nombre de un paso).
 * · LOCAL: el historial vive en la pantalla. Deshacer NO escribe en el servidor; se guarda cuando
 *   el entrenador pulsa Guardar, como siempre. Abrir otra jugada empieza un historial nuevo.
 */

export const HISTORY_LIMIT = 80;
export const COALESCE_MS = 1000;

export interface EditHistory<T> {
  past: T[];
  present: T;
  future: T[];
  /** Clave de la última mutación registrada, para agrupar. */
  lastKey: string | null;
  lastAt: number;
}

export function createHistory<T>(present: T): EditHistory<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 };
}

export interface CommitOptions {
  /** Mutaciones con la misma clave y seguidas se funden en una entrada. */
  key?: string | null;
  now?: number;
  limit?: number;
}

/** Registra un estado nuevo. Mismo objeto = no hay cambio = no hay entrada. */
export function commit<T>(h: EditHistory<T>, next: T, opts: CommitOptions = {}): EditHistory<T> {
  if (Object.is(next, h.present)) return h;
  const now = opts.now ?? Date.now();
  const key = opts.key ?? null;
  const limit = Math.max(1, opts.limit ?? HISTORY_LIMIT);

  // Agrupar: misma clave y seguido → se sustituye el presente sin crear entrada nueva.
  if (key && key === h.lastKey && now - h.lastAt < COALESCE_MS) {
    return { past: h.past, present: next, future: [], lastKey: key, lastAt: now };
  }

  const past = [...h.past, h.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}

export function undo<T>(h: EditHistory<T>): EditHistory<T> {
  if (h.past.length === 0) return h;
  const previous = h.past[h.past.length - 1];
  return {
    past: h.past.slice(0, -1),
    present: previous,
    future: [h.present, ...h.future],
    lastKey: null,
    lastAt: 0,
  };
}

export function redo<T>(h: EditHistory<T>): EditHistory<T> {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest, lastKey: null, lastAt: 0 };
}

export const canUndo = (h: EditHistory<unknown>): boolean => h.past.length > 0;
export const canRedo = (h: EditHistory<unknown>): boolean => h.future.length > 0;

/**
 * ¿Este atajo de teclado es deshacer o rehacer? Devuelve `null` si no lo es, o si el foco está en
 * un campo de texto: ahí Ctrl+Z es el deshacer DEL TEXTO del navegador y la pizarra no lo roba.
 *
 *   Ctrl/Cmd+Z          → deshacer
 *   Ctrl/Cmd+Shift+Z    → rehacer
 *   Ctrl+Y              → rehacer
 */
export function historyShortcut(e: {
  key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}): "undo" | "redo" | null {
  const t = e.target;
  const tag = (t?.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return null;
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return null;
  const k = e.key.toLowerCase();
  if (k === "z") return e.shiftKey ? "redo" : "undo";
  if (k === "y" && e.ctrlKey && !e.shiftKey) return "redo";
  return null;
}
