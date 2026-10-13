import { ns, td, getIntlLocale } from "@/i18n/runtime";

const t = ns("season");

/**
 * TIEMPO DE TEMPORADA — RELOJ DEL SERVIDOR Y CUENTAS ATRÁS (Fase 34). PURO.
 *
 * El servidor manda `serverNow` con cada foto. El cliente anota su propio reloj AL RECIBIRLA
 * (`receivedAt`) y, entre refrescos, estima el reloj del servidor sumando SOLO lo transcurrido en
 * local desde entonces:
 *
 *     serverNowEstimado = serverNow + max(0, relojLocal − receivedAt)
 *
 * Así da igual que el reloj del dispositivo vaya adelantado u horas por detrás: la cuenta atrás se
 * ancla en el instante del servidor. Si el reloj local retrocede, no se resta (max 0).
 *
 * Una cuenta atrás que llega a cero NO concede, NO resetea y NO cambia de temporada: pide otra foto
 * (`crossedZero`) y el servidor dice en qué estado está.
 */

export interface ServerClock {
  /** `serverNow` de la última foto (ms UTC). */
  serverNow: number;
  /** Reloj del cliente en el momento de recibirla. Solo para medir tiempo transcurrido. */
  receivedAt: number;
}

export const clockOffset = (serverNow: number, clientReceivedAt: number): number => serverNow - clientReceivedAt;

export function estimateServerNow(clock: ServerClock, clientNow: number): number {
  return clock.serverNow + Math.max(0, clientNow - clock.receivedAt);
}

export interface Countdown {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
  /** Queda menos de un día: se enseña HH:MM:SS. */
  underDay: boolean;
}

export function countdown(targetMs: number, nowMs: number): Countdown {
  const totalMs = Math.max(0, targetMs - nowMs);
  const s = Math.floor(totalMs / 1000);
  return {
    totalMs,
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
    expired: totalMs === 0,
    underDay: totalMs < 86400_000,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ≥ 24 h: «12 DÍAS · 04 HORAS». < 24 h: «HH:MM:SS». Solo formato. */
export function formatCountdown(c: Countdown): { primary: string; mode: "DAYS" | "CLOCK" } {
  if (!c.underDay) {
    return { primary: `${c.days} ${c.days === 1 ? t("DÍA") : t("DÍAS")} · ${pad(c.hours)} ${c.hours === 1 ? t("HORA") : t("HORAS")}`, mode: "DAYS" };
  }
  return { primary: `${pad(c.hours)}:${pad(c.minutes)}:${pad(c.seconds)}`, mode: "CLOCK" };
}

/** Frase para lectores de pantalla. Sin segundos: no se anuncia cada tic. */
export function countdownSentence(c: Countdown, verb: "Termina en" | "Comienza en"): string {
  if (c.expired) return verb === "Termina en" ? t("El plazo ha terminado; actualizando con el servidor.") : t("Está a punto de empezar; actualizando con el servidor.");
  const parts: string[] = [];
  if (c.days > 0) parts.push(t("{n, plural, one {# día} other {# días}}", { n: c.days }));
  if (c.hours > 0 || c.days > 0) parts.push(t("{n, plural, one {# hora} other {# horas}}", { n: c.hours }));
  if (c.days === 0) parts.push(t("{n, plural, one {# minuto} other {# minutos}}", { n: c.minutes }));
  return `${td(verb)} ${parts.join(` ${t("y")} `)}`;
}

/** Cada cuánto repintar: 1 s en el último día, 30 s el resto. Presentación, sin red. */
export const tickMs = (c: Countdown): number => (c.underDay ? 1000 : 30_000);

/** ¿Acaba de cruzar el cero? Entonces se pide otra foto (una vez), nunca se decide nada. */
export const crossedZero = (prevTotalMs: number, nextTotalMs: number): boolean => prevTotalMs > 0 && nextTotalMs === 0;

/** Fracción transcurrida de una ventana [start, end). */
export function elapsedFraction(startMs: number, endMs: number, now: number): number {
  if (endMs <= startMs) return 0;
  return Math.min(1, Math.max(0, (now - startMs) / (endMs - startMs)));
}

/** Fecha absoluta en la zona del usuario (o la que se pase, para tests). Presentación. */
export function formatSeasonDate(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone, timeZoneName: "short",
  }).format(new Date(ms));
}

/** Fecha corta para calendarios («7 sept»). */
export function formatShortDate(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), { day: "numeric", month: "short", timeZone }).format(new Date(ms));
}
