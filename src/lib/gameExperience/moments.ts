/**
 * FASE 44 · MOMENTOS DE JUEGO — cola pura.
 *
 * «OBJETIVO COMPLETADO», «SUBIDA DE NIVEL», «PLANTILLA LISTA», «EQUIPO ACTIVO», «LOGRO DESBLOQUEADO»… No son toasts de
 * web: son un rótulo breve con luz, de uno en uno, que NUNCA bloquea la pantalla (sin capa encima, sin foco robado).
 *
 * Reglas que protege este reductor (y que el fuzzer de movimiento recorre 10.000 veces):
 *   · uno visible como mucho; el resto espera en cola acotada (`MAX_QUEUE`), sin duplicados del mismo `key`;
 *   · todo momento visible caduca (`expiresAt`), así que no puede quedarse pegado;
 *   · un momento solo existe si quien lo emite tiene el HECHO real (lo exige el tipo: `fact` obligatorio).
 */
import type { MotionLevel } from "@/design/motion";
import type { ProgressEvent } from "@/domain/progression/meta";

/**
 * Momentos a partir de eventos REALES entre dos lecturas del servidor (`progressEvents`): nivel, objetivo completado
 * y logro conseguido. La clave es la identidad estable del evento, así que el mismo hecho no se celebra dos veces.
 * `PACK_REWARD` no genera momento (la ceremonia del sobre ya es el momento).
 */
export function momentsFromProgress(events: readonly ProgressEvent[]): Moment[] {
  const out: Moment[] = [];
  for (const e of events) {
    const fact = e.text.includes(" · ") ? e.text.slice(e.text.indexOf(" · ") + 3) : e.text;
    if (e.kind === "OBJECTIVE_COMPLETE") out.push({ key: e.id, kind: "objective", fact, reward: null });
    else if (e.kind === "ACHIEVEMENT") out.push({ key: e.id, kind: "achievement", fact, reward: null });
    else if (e.kind === "LEVEL_UP") out.push({ key: e.id, kind: "level-up", fact: e.text.replace(/[¡!]/g, ""), reward: null });
  }
  return out;
}

export type MomentKind = "objective" | "level-up" | "achievement" | "deck-ready" | "deck-active" | "deck-saved" | "reward" | "prediction" | "rating";

export const MOMENT_COPY: Record<MomentKind, { title: string; level: MotionLevel; tone: "gold" | "cyan" | "key" | "ok" }> = {
  objective: { title: "Objetivo completado", level: 3, tone: "gold" },
  "level-up": { title: "Subida de nivel", level: 3, tone: "cyan" },
  achievement: { title: "Logro desbloqueado", level: 3, tone: "gold" },
  "deck-ready": { title: "Plantilla lista", level: 3, tone: "ok" },
  "deck-active": { title: "Equipo activo", level: 2, tone: "cyan" },
  "deck-saved": { title: "Equipo guardado", level: 2, tone: "ok" },
  reward: { title: "Recompensa conseguida", level: 3, tone: "gold" },
  prediction: { title: "Predicción guardada", level: 2, tone: "cyan" },
  rating: { title: "Rating actualizado", level: 3, tone: "key" },
};

export interface Moment {
  key: string;
  kind: MomentKind;
  /** El hecho real que lo justifica («Gana un duelo», «Nivel 7», «Equipo 2»). */
  fact: string;
  /** Recompensa real, si la hay («+250 créditos · +200 XP del pase»). */
  reward?: string | null;
}

export interface MomentState {
  visible: (Moment & { shownAt: number; expiresAt: number }) | null;
  queue: Moment[];
  /** Claves ya enseñadas: «animación de completar una vez; después, estado estable». */
  seen: string[];
}

export const MAX_QUEUE = 4;
export const MAX_SEEN = 64;

export function momentDuration(kind: MomentKind, reduced: boolean): number {
  return reduced ? 2600 : MOMENT_COPY[kind].level >= 3 ? 3200 : 2400;
}

export type MomentEvent =
  | { type: "push"; moment: Moment; now: number; reduced?: boolean }
  | { type: "dismiss"; now: number; reduced?: boolean }
  | { type: "tick"; now: number; reduced?: boolean }
  | { type: "reset" };

export const EMPTY_MOMENTS: MomentState = { visible: null, queue: [], seen: [] };

function show(state: MomentState, now: number, reduced: boolean): MomentState {
  if (state.visible || state.queue.length === 0) return state;
  const [next, ...rest] = state.queue;
  return {
    visible: { ...next, shownAt: now, expiresAt: now + momentDuration(next.kind, reduced) },
    queue: rest,
    seen: [...state.seen, next.key].slice(-MAX_SEEN),
  };
}

export function momentsReducer(state: MomentState, e: MomentEvent): MomentState {
  switch (e.type) {
    case "reset":
      return EMPTY_MOMENTS;
    case "push": {
      const m = e.moment;
      if (!m.key || !m.fact || !(m.kind in MOMENT_COPY)) return state;
      if (state.seen.includes(m.key) || state.visible?.key === m.key || state.queue.some((q) => q.key === m.key)) return state;
      if (state.queue.length >= MAX_QUEUE) return state;
      return show({ ...state, queue: [...state.queue, m] }, e.now, !!e.reduced);
    }
    case "dismiss":
      return show({ ...state, visible: null }, e.now, !!e.reduced);
    case "tick":
      if (state.visible && e.now >= state.visible.expiresAt) return show({ ...state, visible: null }, e.now, !!e.reduced);
      return show(state, e.now, !!e.reduced);
  }
}
