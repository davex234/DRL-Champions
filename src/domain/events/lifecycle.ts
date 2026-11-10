/**
 * CICLO DE VIDA DE UN EVENTO (Fase 12) — dominio PURO.
 *
 * ────────────────────────── EL PROBLEMA QUE RESUELVE ──────────────────────────
 *
 * La Fase 10 dejó escrito el hueco: «Eventos — autoridad de servidor: su economía vive en
 * `localStorage`». El evento estilo FUT (`domain/events/*`, `useEventsStore`) decide en el
 * navegador cuándo empieza, cuándo acaba y qué se puede reclamar. Con sesión iniciada eso
 * no se sostiene: basta con adelantar el reloj del sistema para que un evento terminado
 * vuelva a estar «vivo».
 *
 * ────────────────────────── LA DECISIÓN ──────────────────────────
 *
 * **No se crea una tabla de eventos nueva.** `public.events` ya existe desde la migración
 * 0002, ya la llena la sincronización competitiva con torneos reales y ya tiene las tres
 * columnas que hacen falta: `status`, `start_date` y `end_date`. Un evento de NEXUS ES un
 * torneo del circuito; inventar una segunda entidad «evento» al lado sería exactamente el
 * sistema paralelo que la Fase 12 prohíbe.
 *
 * Lo que faltaba no era una tabla: era **la función que traduce dos marcas de tiempo y un
 * estado en una fase**, escrita una sola vez y ejecutada en el servidor.
 *
 * ────────────────────────── LAS CINCO FASES ──────────────────────────
 *
 *   UPCOMING   anunciado, todavía no ha empezado
 *   LIVE       en marcha
 *   ENDING     en marcha, pero le quedan menos de 48 h — es una fase distinta porque la
 *              interfaz tiene que decir «corre», no «tienes tiempo»
 *   COMPLETED  terminado, pero dentro del plazo de reclamación
 *   ARCHIVED   terminado y cerrado: ya no se puede reclamar nada
 *
 * ────────────────────────── POR QUÉ HAY PLAZO DE GRACIA ──────────────────────────
 *
 * El encargo pide que los logros de evento «dejen de ser reclamables cuando termine el
 * evento». Aplicado al pie de la letra sería injusto: los puntos de un Pick'em se corrigen
 * CUANDO acaba el torneo, así que el desafío «acierta cinco predicciones» solo se puede
 * completar después del final. Cerrar la puerta en el instante del pitido final dejaría sin
 * cobrar a quien lo ganó.
 *
 * Por eso la ventana no se cierra al terminar: se cierra `CLAIM_GRACE_DAYS` después. Es un
 * plazo, no una puerta abierta, y `ARCHIVED` la cierra de verdad.
 *
 * ────────────────────────── QUIÉN DECIDE ──────────────────────────
 *
 * Este módulo es puro y no sabe qué hora es: el `now` llega siempre como parámetro. Quien
 * lo llama con la hora del servidor es `server/services/events.ts`. El navegador puede usar
 * las mismas funciones para PINTAR, pero su respuesta no autoriza nada.
 */

export type EventPhase = "upcoming" | "live" | "ending" | "completed" | "archived";

/** Últimas horas de un evento: la interfaz debe meter prisa, no acompañar. */
export const ENDING_WINDOW_HOURS = 48;

/** Plazo para reclamar después del final. Ver la cabecera: los Pick'ems se corrigen tarde. */
export const CLAIM_GRACE_DAYS = 7;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Lo mínimo que hace falta saber de un evento para situarlo en el tiempo. */
export interface EventTiming {
  /** `public.events.status`, tal cual lo escribe la sincronización. */
  status: string | null;
  startDate: string | null;
  endDate: string | null;
}

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * La fase de un evento.
 *
 * El orden de las comprobaciones importa y es deliberado: **las fechas mandan sobre el
 * estado**. `status` lo escribe la sincronización competitiva y puede quedarse rezagado —un
 * torneo que terminó ayer sigue marcado `ongoing` hasta la siguiente pasada—, mientras que
 * `end_date` es un hecho. Si se confiara en `status`, un evento acabado seguiría repartiendo
 * recompensas hasta que alguien ejecutara una sincronización.
 *
 * Cuando no hay fechas —y las hay que faltan: la sincronización no siempre las trae— se cae
 * al `status`, que es lo único que queda. Se declara como degradación, no como norma.
 */
export function eventPhase(ev: EventTiming, now: number): EventPhase {
  const start = ms(ev.startDate);
  const end = ms(ev.endDate);

  if (end !== null) {
    if (now >= end + CLAIM_GRACE_DAYS * DAY) return "archived";
    if (now >= end) return "completed";
  }
  if (start !== null && now < start) return "upcoming";

  // Aquí ya se sabe que empezó (o que no hay fecha de inicio) y que no ha terminado.
  if (end !== null && end - now <= ENDING_WINDOW_HOURS * HOUR) return "ending";
  if (start !== null || end !== null) return "live";

  // Sin ninguna fecha: solo queda creer al estado.
  const s = (ev.status ?? "").toLowerCase();
  if (s === "upcoming" || s === "scheduled") return "upcoming";
  if (s === "completed" || s === "finished" || s === "ended") return "completed";
  return "live";
}

/** Fases en las que un desafío de evento todavía se puede cobrar. */
export const CLAIMABLE_PHASES: readonly EventPhase[] = ["live", "ending", "completed"];

export const canClaimInPhase = (phase: EventPhase): boolean => CLAIMABLE_PHASES.includes(phase);

/** ¿El evento acepta participación nueva? Terminado ya no: solo cobrar lo ganado. */
export const isRunning = (phase: EventPhase): boolean => phase === "live" || phase === "ending";

/**
 * Instante en que se cierra la ventana de reclamación, o `null` si no se puede saber
 * (un evento sin `end_date` no tiene cierre calculable, y fingir uno sería inventar).
 */
export function claimClosesAt(ev: EventTiming): number | null {
  const end = ms(ev.endDate);
  return end === null ? null : end + CLAIM_GRACE_DAYS * DAY;
}

/** Milisegundos hasta el próximo cambio de fase, para que la interfaz sepa qué contar. */
export function msUntilNextPhase(ev: EventTiming, now: number): number | null {
  const start = ms(ev.startDate);
  const end = ms(ev.endDate);
  const phase = eventPhase(ev, now);

  if (phase === "upcoming" && start !== null) return Math.max(0, start - now);
  if (phase === "live" && end !== null) return Math.max(0, end - ENDING_WINDOW_HOURS * HOUR - now);
  if (phase === "ending" && end !== null) return Math.max(0, end - now);
  if (phase === "completed") {
    const closes = claimClosesAt(ev);
    return closes === null ? null : Math.max(0, closes - now);
  }
  return null;
}

/** Etiqueta corta en castellano. Vive aquí para que servidor y cliente digan lo mismo. */
export const PHASE_LABEL: Record<EventPhase, string> = {
  upcoming: "Próximamente",
  live: "En directo",
  ending: "Termina pronto",
  completed: "Terminado",
  archived: "Archivado",
};
