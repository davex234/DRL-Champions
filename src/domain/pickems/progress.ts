/**
 * ESTADO, PROGRESO Y FASES DE UN PICK'EM (Fase 24.2) — funciones PURAS.
 *
 * ────────────────────────── QUÉ ES ──────────────────────────
 *
 * Todo lo que la pantalla de Pick'ems necesita DEDUCIR de los datos que ya trae el
 * servidor, en un solo sitio y sin red: en qué estado está cada predicción para este
 * usuario, cuántas lleva respondidas, cuál es la siguiente en cerrar, en qué fase está el
 * torneo y en qué posición queda en una lista ya ordenada.
 *
 * ────────────────────────── QUÉ NO ES ──────────────────────────
 *
 * **No corrige, no puntúa y no ordena.** Un acierto es `pickem_answers.is_correct`, que lo
 * escribe `app_score_pickem_event`; los puntos ganados son `points_award`, de la misma
 * RPC; la posición es el índice en la fila que devuelve `ranking_pickem_event`. Cuando el
 * corrector aún no ha pasado por una pregunta que ya tiene resultado, se LEE
 * `correct_option` —que la vista pública solo expone tras el cierre— para poder enseñar
 * «acertada/fallada» sin esperar a la siguiente pasada; los puntos, en ese caso, no se
 * afirman: se marcan como pendientes.
 *
 * El «ahora» entra como parámetro: la pantalla lo usa para apagar un botón cuya cuenta
 * atrás ha llegado a cero, pero el que decide si una predicción entra es `app_submit_pick`
 * con el reloj de la base de datos. Aquí solo se dibuja.
 */

/** Lo que una pregunta necesita para saberse su estado. Es un subconjunto de `PickemQuestion`. */
export interface QuestionLike {
  id: string;
  kind: string;
  points: number;
  locks_at: string;
  locked: boolean;
  correct_option: string | null;
  order_idx: number;
  options: { key: string; label: string }[];
}

/** Mi respuesta a una pregunta, con lo que el corrector dejó escrito sobre ella. */
export interface MyAnswer {
  option: string;
  /** `null` hasta que el corrector pase por esta pregunta. */
  isCorrect: boolean | null;
  /** Puntos concedidos por el corrector; `null` hasta que pase. */
  pointsAward: number | null;
}

export type AnswerMap = Record<string, MyAnswer>;

/**
 * Los siete estados de una predicción para un usuario.
 *
 *   pendiente        abierta, sin responder
 *   elegida          abierta, respondida (se puede cambiar)
 *   bloqueada        cerrada, respondida, sin resultado todavía
 *   sin-prediccion   cerrada, SIN responder — ya no se puede
 *   acertada         corregida y acertada
 *   fallada          corregida y fallada
 *   sin-participar   corregida y no se respondió
 */
export type PickState =
  | "pendiente" | "elegida" | "bloqueada" | "sin-prediccion"
  | "acertada" | "fallada" | "sin-participar";

/** ¿Está cerrada AHORA, a ojos del cliente? El servidor manda; esto solo apaga el botón. */
export function isLockedNow(q: Pick<QuestionLike, "locked" | "locks_at">, now?: number): boolean {
  if (q.locked) return true;
  if (now === undefined) return false;
  const t = Date.parse(q.locks_at);
  return Number.isFinite(t) && t <= now;
}

export function stateOf(q: QuestionLike, mine: MyAnswer | undefined, now?: number): PickState {
  const locked = isLockedNow(q, now);
  const resolved = locked && !!q.correct_option;
  if (resolved) {
    if (!mine) return "sin-participar";
    if (mine.isCorrect === true) return "acertada";
    if (mine.isCorrect === false) return "fallada";
    // El corrector no ha pasado todavía: se lee el resultado ya publicado.
    return mine.option === q.correct_option ? "acertada" : "fallada";
  }
  if (locked) return mine ? "bloqueada" : "sin-prediccion";
  return mine ? "elegida" : "pendiente";
}

export const isResolvedState = (s: PickState): boolean =>
  s === "acertada" || s === "fallada" || s === "sin-participar";

/**
 * Puntos que el corrector concedió por esta pregunta, o `null` si aún no ha pasado.
 * No se calculan: si `points_award` no está, no hay cifra que afirmar.
 */
export function awardedPoints(mine: MyAnswer | undefined): number | null {
  if (!mine) return null;
  return mine.pointsAward;
}

export interface Progress {
  total: number;
  answered: number;
  /** Abiertas sin responder: lo que requiere acción. */
  pending: number;
  /** Cerradas sin responder: ya no se puede. */
  lockedUnanswered: number;
  /** Cerradas, respondidas, esperando resultado. */
  inPlay: number;
  /** Con resultado, participara o no. */
  resolved: number;
  hits: number;
  misses: number;
  /** Respondidas sobre el total, en porcentaje entero. */
  pct: number;
}

export function progressOf(questions: QuestionLike[], answers: AnswerMap, now?: number): Progress {
  const p: Progress = {
    total: questions.length, answered: 0, pending: 0, lockedUnanswered: 0,
    inPlay: 0, resolved: 0, hits: 0, misses: 0, pct: 0,
  };
  for (const q of questions) {
    const mine = answers[q.id];
    if (mine) p.answered++;
    switch (stateOf(q, mine, now)) {
      case "pendiente": p.pending++; break;
      case "sin-prediccion": p.lockedUnanswered++; break;
      case "bloqueada": p.inPlay++; break;
      case "acertada": p.resolved++; p.hits++; break;
      case "fallada": p.resolved++; p.misses++; break;
      case "sin-participar": p.resolved++; break;
      default: break;
    }
  }
  p.pct = p.total > 0 ? Math.round((p.answered / p.total) * 100) : 0;
  return p;
}

/** Puntos que todavía se pueden ganar con lo que ya está respondido y sin corregir. */
export function pointsInPlay(questions: QuestionLike[], answers: AnswerMap, now?: number): number {
  let sum = 0;
  for (const q of questions) {
    const s = stateOf(q, answers[q.id], now);
    if (s === "elegida" || s === "bloqueada") sum += Math.max(0, q.points);
  }
  return sum;
}

/** Tipos de pregunta que se enseñan como DESTACADAS: las del torneo entero. */
export const FEATURED_KINDS = new Set(["champion", "advance"]);

export interface Grouped<Q extends QuestionLike> {
  /** Campeón / clasificación. */
  featured: Q[];
  /** Abiertas, en orden de cierre (la que cierra antes, primero). */
  open: Q[];
  /** Cerradas sin resultado, en orden de cierre. */
  inPlay: Q[];
  /** Con resultado: la última corregida, primero. */
  resolved: Q[];
}

const byLock = (a: QuestionLike, b: QuestionLike) =>
  Date.parse(a.locks_at) - Date.parse(b.locks_at) || a.order_idx - b.order_idx;

/**
 * Reparte las preguntas por lo que se puede hacer con ellas. No esconde ninguna: cada
 * pregunta está en exactamente un grupo. Dentro del grupo se ordenan por cierre, que es
 * el orden en que el jugador las necesita.
 */
export function groupQuestions<Q extends QuestionLike>(questions: Q[], now?: number): Grouped<Q> {
  const g: Grouped<Q> = { featured: [], open: [], inPlay: [], resolved: [] };
  for (const q of questions) {
    if (FEATURED_KINDS.has(q.kind)) { g.featured.push(q); continue; }
    const locked = isLockedNow(q, now);
    if (!locked) g.open.push(q);
    else if (q.correct_option) g.resolved.push(q);
    else g.inPlay.push(q);
  }
  g.featured.sort((a, b) => a.order_idx - b.order_idx);
  g.open.sort(byLock);
  g.inPlay.sort(byLock);
  g.resolved.sort((a, b) => byLock(b, a));
  return g;
}

/** La siguiente pregunta en cerrar (la cuenta atrás del héroe), o `null` si no queda ninguna. */
export function nextToLock<Q extends QuestionLike>(questions: Q[], now: number): Q | null {
  let best: Q | null = null;
  for (const q of questions) {
    if (isLockedNow(q, now)) continue;
    if (!best || Date.parse(q.locks_at) < Date.parse(best.locks_at)) best = q;
  }
  return best;
}

/* ─────────────────────────────── Fase del torneo ─────────────────────────────── */

export type EventPhase = "activo" | "proximo" | "finalizado";

export interface EventLike {
  /** `pickem_events.status`: draft | open | locked | scored. */
  status: string;
  /** `events.status` normalizado por el importador: upcoming | live | finished. */
  eventStatus?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

const FINISHED_EVENT = new Set(["finished", "completed", "final"]);

/**
 * En qué fase está el torneo, con los datos reales y nada más.
 *
 *   activo      hay algo que hacer o algo en juego: preguntas abiertas o cerradas sin resultado
 *   finalizado  el origen dice que terminó, o ya no queda nada abierto ni en juego
 *   proximo     todavía no ha empezado y no hay preguntas publicadas
 */
export function eventPhase(ev: EventLike, questions: QuestionLike[], now: number): EventPhase {
  let open = 0, inPlay = 0;
  for (const q of questions) {
    if (!isLockedNow(q, now)) open++;
    else if (!q.correct_option) inPlay++;
  }
  if (open > 0 || inPlay > 0) return "activo";

  const finishedBySource = FINISHED_EVENT.has((ev.eventStatus ?? "").toLowerCase());
  const ended = ev.endDate ? Date.parse(ev.endDate) < now : false;
  if (ev.status === "scored" || finishedBySource || ended) return "finalizado";
  if (questions.length > 0) return "finalizado"; // todo cerrado y corregido
  const started = ev.startDate ? Date.parse(ev.startDate) <= now : false;
  return started ? "finalizado" : "proximo";
}

/**
 * La fase SIN preguntas cargadas, para el selector de torneos (no se piden las preguntas de
 * todos los torneos solo para etiquetarlos: sería una consulta por torneo).
 *
 *   finalizado  el origen dice que terminó, o el cierre del Pick'em ya pasó
 *   proximo     el Pick'em todavía no ha abierto
 *   activo      lo demás: se puede predecir o hay algo en juego
 */
export function eventPhaseCoarse(
  ev: EventLike & { opensAt?: string | null; locksAt?: string | null }, now: number,
): EventPhase {
  const src = (ev.eventStatus ?? "").toLowerCase();
  if (FINISHED_EVENT.has(src)) return "finalizado";
  if (src === "live" || src === "ongoing") return "activo";
  if (ev.opensAt && Date.parse(ev.opensAt) > now) return "proximo";
  if (ev.locksAt && Date.parse(ev.locksAt) <= now) return "finalizado";
  return "activo";
}

export const PHASE_LABEL: Record<EventPhase, string> = {
  activo: "Activo", proximo: "Próximo", finalizado: "Finalizado",
};

/* ────────────────────────────────── Posición ────────────────────────────────── */

/**
 * Mi posición en una lista que YA viene ordenada por el servidor (`ranking_pickem_event`
 * ordena por puntos). Es el índice más uno; no se reordena nada.
 */
export function positionOf(rows: { user_id: string }[], userId: string | null | undefined): number | null {
  if (!userId) return null;
  const i = rows.findIndex((r) => r.user_id === userId);
  return i >= 0 ? i + 1 : null;
}

/**
 * Mi posición a partir de las puntuaciones de un torneo: uno más los que tienen MÁS puntos
 * que yo. Es el mismo criterio que la vista (`points desc`), y se usa donde no se ha pedido
 * la clasificación entera (el historial). Sin fila propia, no hay posición.
 */
export function positionAmong(
  scores: { user_id: string; points: number }[], userId: string | null | undefined,
): number | null {
  if (!userId) return null;
  const mine = scores.find((s) => s.user_id === userId);
  if (!mine) return null;
  let ahead = 0;
  for (const s of scores) if (s.points > mine.points) ahead++;
  return ahead + 1;
}
